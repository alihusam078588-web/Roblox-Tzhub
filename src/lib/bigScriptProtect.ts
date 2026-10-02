// @ts-nocheck
// Big-script protector: splits big Lua/Luau scripts into pieces (<256 KB), obfuscates each piece through
// the same-origin /api/protect proxy (-> rbx.lol), and stitches the protected pieces back into ONE script.
// Usage:  const r = await protectBig(code, { onStatus, onProgress, signal });  if (r.ok) use r.out; else show r.error
  // ───────────────────────── lexer ─────────────────────────
  const KW = new Set('and break do else elseif end false for function if in local nil not or repeat return then true until while'.split(' '));
  const OPS3 = ['...', '//=', '..='];
  const OPS2 = ['==', '~=', '<=', '>=', '::', '->', '+=', '-=', '*=', '/=', '%=', '^=', '//', '..'];
  const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '//=', '%=', '^=', '..=']);
  const NUM_RE = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)/y;
  const ID_RE = /[A-Za-z_][A-Za-z0-9_]*/y;

  function lex(src) {
    const toks = [], comments = [];
    const n = src.length;
    let i = 0, nl = false;
    const push = (t, v, s, e) => { toks.push({ t, v, s, e, nl }); nl = false; };
    while (i < n) {
      const c = src[i];
      if (c === '\n') { nl = true; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
      if (c === '-' && src[i + 1] === '-') {
        const s = i; i += 2;
        const m = /^\[(=*)\[/.exec(src.substr(i, 130));
        if (m) {
          const close = ']' + m[1] + ']';
          const k = src.indexOf(close, i + m[0].length);
          i = k < 0 ? n : k + close.length;
          const nlPos = src.indexOf('\n', s);
          if (nlPos >= 0 && nlPos < i) nl = true;
        } else {
          const k = src.indexOf('\n', i);
          i = k < 0 ? n : k;
        }
        comments.push([s, i]);
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1;
        while (j < n) {
          const d = src[j];
          if (d === '\\') { j += 2; continue; }
          if (d === c) { j++; break; }
          if (d === '\n' && c !== '`') break;
          j++;
        }
        push('str', src.slice(i, j), i, j); i = j; continue;
      }
      if (c === '[') {
        const m = /^\[(=*)\[/.exec(src.substr(i, 130));
        if (m) {
          const close = ']' + m[1] + ']';
          const k = src.indexOf(close, i + m[0].length);
          const j = k < 0 ? n : k + close.length;
          push('str', src.slice(i, j), i, j); i = j; continue;
        }
      }
      if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
        NUM_RE.lastIndex = i;
        const m = NUM_RE.exec(src);
        if (m) { push('num', m[0], i, i + m[0].length); i += m[0].length; continue; }
      }
      if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
        ID_RE.lastIndex = i;
        const m = ID_RE.exec(src);
        push(KW.has(m[0]) ? 'kw' : 'id', m[0], i, i + m[0].length); i += m[0].length; continue;
      }
      const s3 = src.substr(i, 3);
      if (OPS3.includes(s3)) { push('op', s3, i, i + 3); i += 3; continue; }
      const s2 = s3.slice(0, 2);
      if (OPS2.includes(s2)) { push('op', s2, i, i + 2); i += 2; continue; }
      push('op', c, i, i + 1); i++;
    }
    return { toks, comments };
  }

  // ───────────────────── compaction ─────────────────────
  // Removes comments, indentation, blank lines and repeated spaces - but never touches anything
  // inside strings, and keeps a line break wherever the original had one (so no statement can fuse).
  // Luau directives such as --!strict / --!native are kept.
  function stripComments(src) {
    const { toks, comments } = lex(src);
    const dirs = comments.filter(([s]) => src.startsWith('--!', s)).map(([s, e]) => src.slice(s, e).trim());
    let out = '', prevEnd = 0;
    for (const t of toks) {
      if (out) out += t.nl ? '\n' : (t.s > prevEnd ? ' ' : '');
      out += src.slice(t.s, t.e);
      prevEnd = t.e;
    }
    return (dirs.length ? dirs.join('\n') + '\n' : '') + out + '\n';
  }

  // ───────────────────── safe splitting ─────────────────────
  const START_KW = new Set(['local', 'function', 'if', 'for', 'while', 'do', 'repeat', 'return', 'break']);
  const ENDER_KW = new Set(['end', 'true', 'false', 'nil', 'break']);
  const ENDER_OPS = new Set([')', ']', '}', '...', ';']);
  const EXPR_IF_PREV_KW = new Set(['and', 'or', 'not', 'return', 'in']);
  const NOT_EXPR_IF_OPS = new Set([')', ']', '}', ';', '...', '::']);

  const isStart = t => (t.t === 'kw' && START_KW.has(t.v)) || t.t === 'id';
  const isEnder = t => t.t === 'id' || t.t === 'str' || t.t === 'num' ||
    (t.t === 'kw' && ENDER_KW.has(t.v)) || (t.t === 'op' && ENDER_OPS.has(t.v));

  // A huge `local games = { ["123"] = function() ... end, ["456"] = ... }` is ONE statement, so it can never be
  // split between pieces. This rewrites such a table into  `local games = {}  games["123"] = ...  games["456"] = ...`
  // (same result, but every entry is now its own statement). Only tables whose entries are ALL `[string|number] = value`
  // are rewritten, and never if the table's own name is used inside it.
  function splitTables(src, minBody) {
    const { toks } = lex(src);
    const N = toks.length;
    const depthAt = new Int32Array(N), brAt = new Int32Array(N);
    {
      let depth = 0, br = 0, pendDo = 0;
      for (let i = 0; i < N; i++) {
        const tk = toks[i], prev = toks[i - 1];
        depthAt[i] = depth; brAt[i] = br;
        if (tk.t === 'kw') {
          switch (tk.v) {
            case 'function': case 'repeat': depth++; break;
            case 'do': if (pendDo > 0) pendDo--; depth++; break;
            case 'while': case 'for': pendDo++; break;
            case 'if': {
              const exprIf = prev && ((prev.t === 'op' && !NOT_EXPR_IF_OPS.has(prev.v)) || (prev.t === 'kw' && EXPR_IF_PREV_KW.has(prev.v)));
              if (!exprIf) depth++;
              break;
            }
            case 'end': case 'until': depth = Math.max(0, depth - 1); break;
          }
        } else if (tk.t === 'op') {
          if (tk.v === '(' || tk.v === '{' || tk.v === '[') br++;
          else if (tk.v === ')' || tk.v === '}' || tk.v === ']') br = Math.max(0, br - 1);
        }
      }
    }
    const isOpen = x => x.t === 'op' && (x.v === '(' || x.v === '{' || x.v === '[');
    const isClose = x => x.t === 'op' && (x.v === ')' || x.v === '}' || x.v === ']');
    const bracketKeyAt = k => toks[k] && toks[k].t === 'op' && toks[k].v === '[' && toks[k + 1] &&
      (toks[k + 1].t === 'str' || toks[k + 1].t === 'num') && toks[k + 2] && toks[k + 2].t === 'op' && toks[k + 2].v === ']' &&
      toks[k + 3] && toks[k + 3].t === 'op' && toks[k + 3].v === '=';

    const edits = [];
    for (let i = 0; i + 4 < N; i++) {
      const tk = toks[i];
      if (!(tk.t === 'kw' && tk.v === 'local' && depthAt[i] === 0 && brAt[i] === 0)) continue;
      const nm = toks[i + 1], eq = toks[i + 2], lb = toks[i + 3];
      if (!(nm.t === 'id' && eq.t === 'op' && eq.v === '=' && lb.t === 'op' && lb.v === '{')) continue;
      let b = 0, ce = -1;
      for (let k = i + 3; k < N; k++) {
        if (isOpen(toks[k])) b++;
        else if (isClose(toks[k])) { b--; if (b === 0) { ce = k; break; } }
      }
      if (ce < 0 || toks[ce].e - lb.s < minBody) continue;
      if (toks[ce + 1] && !isStart(toks[ce + 1])) continue;                  // the `}` must end the statement
      let selfUse = false;
      for (let k = i + 4; k < ce; k++) {
        const x = toks[k], pv = toks[k - 1];
        if (x.t === 'id' && x.v === nm.v && !(pv && pv.t === 'op' && (pv.v === '.' || pv.v === ':'))) { selfUse = true; break; }
      }
      if (selfUse) continue;

      const ents = [];
      let k = i + 4, ok = ce > i + 4;
      while (ok && k < ce) {
        if (!bracketKeyAt(k)) { ok = false; break; }
        const key = '[' + toks[k + 1].v + ']';
        const vs = k + 4;
        let bb = 0, rd = 0, pd = 0, e = vs, term = false;
        for (; e < ce; e++) {
          const x = toks[e], pv = toks[e - 1];
          if (x.t === 'kw') {
            switch (x.v) {
              case 'function': case 'repeat': rd++; break;
              case 'do': if (pd > 0) pd--; rd++; break;
              case 'while': case 'for': pd++; break;
              case 'if': {
                const exprIf = pv && ((pv.t === 'op' && !NOT_EXPR_IF_OPS.has(pv.v)) || (pv.t === 'kw' && EXPR_IF_PREV_KW.has(pv.v)));
                if (!exprIf) rd++;
                break;
              }
              case 'end': case 'until': rd = Math.max(0, rd - 1); break;
            }
          } else if (isOpen(x)) bb++;
          else if (isClose(x)) bb--;
          else if (x.t === 'op' && (x.v === ',' || x.v === ';') && bb === 0) {
            if (bracketKeyAt(e + 1) || e + 1 === ce) { term = true; break; }
            if (rd === 0) { ok = false; break; }                                  // positional / extra values: not a pure keyed table
          }
        }
        if (!ok || e <= vs) { ok = false; break; }
        ents.push({ key, text: src.slice(toks[vs].s, toks[e - 1].e) });
        k = term ? e + 1 : e;
      }
      if (!ok || ents.length < 2) continue;
      edits.push({ s: tk.s, e: toks[ce].e, text: `local ${nm.v} = {}\n` + ents.map(x => `${nm.v}${x.key} = ${x.text}`).join('\n') });
      i = ce;
    }
    if (!edits.length) return { src, changed: 0 };
    let out = '', pos = 0;
    for (const ed of edits) { out += src.slice(pos, ed.s) + ed.text; pos = ed.e; }
    return { src: out + src.slice(pos), changed: edits.length };
  }

  // Splits the script at top-level statement boundaries and works out which top-level
  // `local`s are shared between pieces. Locals that are never re-assigned are passed between
  // pieces by value. Locals that ARE re-assigned (mutable state) either force their pieces to stay
  // together, or - in envMode - are turned into shared "globals" that live in a proxy environment.
  function planChunks(src, target, envMode) {
    const { toks } = lex(src);
    const N = toks.length;
    const depthAt = new Array(N);
    const cuts = [0];
    let depth = 0, br = 0, pendDo = 0;

    for (let i = 0; i < N; i++) {
      const tk = toks[i], prev = toks[i - 1];
      depthAt[i] = depth;
      if (i > 0 && depth === 0 && br === 0 && pendDo === 0 && isStart(tk) && isEnder(prev) &&
        !(toks[i - 2] && toks[i - 2].t === 'op' && toks[i - 2].v === '@')) cuts.push(i);   // works on minified one-line scripts too

      if (tk.t === 'kw') {
        switch (tk.v) {
          case 'function': case 'repeat': depth++; break;
          case 'do': if (pendDo > 0) pendDo--; depth++; break;
          case 'while': case 'for': pendDo++; break;
          case 'if': {
            const exprIf = prev && ((prev.t === 'op' && !NOT_EXPR_IF_OPS.has(prev.v)) ||
              (prev.t === 'kw' && EXPR_IF_PREV_KW.has(prev.v)));
            if (!exprIf) depth++;
            break;
          }
          case 'end': case 'until': depth = Math.max(0, depth - 1); break;
        }
      } else if (tk.t === 'op') {
        if (tk.v === '(' || tk.v === '{' || tk.v === '[') br++;
        else if (tk.v === ')' || tk.v === '}' || tk.v === ']') br = Math.max(0, br - 1);
      }
    }

    const S = cuts.length;
    const segOf = new Int32Array(N);              // token → segment index
    for (let k = 0; k < S; k++) {
      const a = cuts[k], b = k + 1 < S ? cuts[k + 1] : N;
      for (let i = a; i < b; i++) segOf[i] = k;
    }
    const segStart = cuts.map((c, k) => (k === 0 ? 0 : toks[c].s));
    const segEnd = cuts.map((c, k) => (k + 1 < S ? toks[cuts[k + 1]].s : src.length));

    // declarations, uses, assignments
    const declTok = new Set();
    const declared = Array.from({ length: S }, () => []);       // top-level local names per segment
    const used = Array.from({ length: S }, () => new Set());
    const mutable = new Set();
    const stmts = [];                                           // top-level `local` statements
    let hasTopReturnLast = false;

    for (let i = 0; i < N; i++) {
      const tk = toks[i];
      if (tk.t === 'kw' && tk.v === 'local') {
        const names = [];
        let j = i + 1, anno = false, lastEnd = tk.e, isFunc = false;
        if (toks[j] && toks[j].t === 'kw' && toks[j].v === 'function') {
          isFunc = true;
          if (toks[j + 1] && toks[j + 1].t === 'id') { names.push(toks[j + 1].v); declTok.add(j + 1); lastEnd = toks[j + 1].e; }
        } else {
          while (j < N && toks[j].t === 'id') {
            names.push(toks[j].v); declTok.add(j); lastEnd = toks[j].e; j++;
            if (toks[j] && toks[j].t === 'op' && toks[j].v === ':') {          // skip type annotation
              anno = true;
              let b = 0; j++;
              while (j < N) {
                const x = toks[j];
                if (x.t === 'op') {
                  if (x.v === '(' || x.v === '{' || x.v === '[' || x.v === '<') b++;
                  else if (x.v === ')' || x.v === '}' || x.v === ']' || x.v === '>') b--;
                  else if ((x.v === ',' || x.v === '=') && b <= 0) break;
                } else if (x.t === 'kw' && b <= 0 && x.v !== 'function' && x.v !== 'nil') break;
                j++;
              }
            }
            if (toks[j] && toks[j].t === 'op' && toks[j].v === ',') { j++; continue; }
            break;
          }
        }
        if (depthAt[i] === 0) {
          declared[segOf[i]].push(...names);
          stmts.push({ i, names, anno, isFunc, lastEnd, hasInit: !!(toks[j] && toks[j].t === 'op' && toks[j].v === '=') });
        }
      }
      // type aliases at top level are treated as mutable (never passed between pieces)
      if (tk.t === 'id' && tk.v === 'type' && depthAt[i] === 0 && toks[i + 1] && toks[i + 1].t === 'id' &&
        toks[i + 2] && toks[i + 2].t === 'op' && (toks[i + 2].v === '=' || toks[i + 2].v === '<') &&
        !(toks[i - 1] && toks[i - 1].t === 'op' && (toks[i - 1].v === '.' || toks[i - 1].v === ':'))) {
        declared[segOf[i]].push(toks[i + 1].v); mutable.add(toks[i + 1].v);
      }
    }

    for (let i = 0; i < N; i++) {
      const tk = toks[i];
      if (tk.t !== 'id') continue;
      const prev = toks[i - 1], next = toks[i + 1];
      const member = prev && prev.t === 'op' && (prev.v === '.' || prev.v === ':');
      if (member) continue;
      used[segOf[i]].add(tk.v);
      if (declTok.has(i)) continue;
      if (prev && prev.t === 'kw' && (prev.v === 'for' || prev.v === 'function')) continue;
      if (next && next.t === 'op' && ASSIGN_OPS.has(next.v)) mutable.add(tk.v);
    }
    // multi-assignment lists:  a, b.c, d = ...
    for (let i = 0; i < N; i++) {
      const tk = toks[i], prev = toks[i - 1];
      if (tk.t !== 'id' || declTok.has(i)) continue;
      const stmtStart = !prev || tk.nl || (prev.t === 'op' && prev.v === ';') ||
        (prev.t === 'kw' && (prev.v === 'then' || prev.v === 'do' || prev.v === 'else' || prev.v === 'repeat'));
      if (!stmtStart) continue;
      let j = i; const cand = [];
      for (;;) {
        if (!toks[j] || toks[j].t !== 'id') break;
        const nx = toks[j + 1];
        if (nx && nx.t === 'op' && (nx.v === ',' || ASSIGN_OPS.has(nx.v))) cand.push(toks[j].v);
        j++;
        for (;;) {
          const x = toks[j], y = toks[j + 1];
          if (x && x.t === 'op' && x.v === '.' && y && y.t === 'id') { j += 2; continue; }
          if (x && x.t === 'op' && x.v === '[') {
            let b = 0;
            while (j < N) { const z = toks[j]; if (z.t === 'op') { if (z.v === '[') b++; else if (z.v === ']') { b--; if (b === 0) { j++; break; } } } j++; }
            continue;
          }
          break;
        }
        if (toks[j] && toks[j].t === 'op' && toks[j].v === ',') { j++; continue; }
        break;
      }
      if (cand.length && toks[j] && toks[j].t === 'op' && ASSIGN_OPS.has(toks[j].v)) cand.forEach(nm => mutable.add(nm));
    }
    // top-level `return` in the last segment (script returns a value)
    for (let i = Math.max(0, cuts[S - 1]); i < N; i++) {
      if (toks[i].t === 'kw' && toks[i].v === 'return' && depthAt[i] === 0) hasTopReturnLast = true;
    }

    // envMode: top-level locals that are re-assigned become shared "globals" (declaration loses `local`)
    const edits = [];
    const converted = new Set();
    if (envMode) {
      const topCount = new Map();
      for (const st of stmts) for (const nm of st.names) topCount.set(nm, (topCount.get(nm) || 0) + 1);
      for (const st of stmts) {
        if (st.anno || !st.names.some(n => mutable.has(n)) || !st.names.every(n => topCount.get(n) === 1)) continue;
        st.names.forEach(n => converted.add(n));
        edits.push({ s: toks[st.i].s, e: toks[st.i].e, text: '' });
        if (!st.hasInit && !st.isFunc) edits.push({ s: st.lastEnd, e: st.lastEnd, text: ' = ' + st.names.map(() => 'nil').join(', ') });
      }
      for (let k = 0; k < S; k++) declared[k] = declared[k].filter(n => !converted.has(n));
    }

    // dependency analysis
    const declSegs = new Map();                      // name → [segment indices] ascending
    for (let k = 0; k < S; k++) for (const nm of declared[k]) {
      const a = declSegs.get(nm) || [];
      if (a[a.length - 1] !== k) a.push(k);
      declSegs.set(nm, a);
    }
    const latestDecl = (nm, j) => {                  // latest segment < j declaring nm, or -1
      const a = declSegs.get(nm); if (!a) return -1;
      let r = -1; for (const k of a) { if (k < j) r = k; else break; } return r;
    };
    const diff = new Int32Array(S + 1);              // forbidden gaps (gap g = between seg g and g+1)
    const deps = [];                                 // {name, from, to}
    const blockSpan = new Map();                     // name → longest span it pins together
    for (let j = 0; j < S; j++) for (const nm of used[j]) {
      const i = latestDecl(nm, j);
      if (i < 0) continue;
      if (mutable.has(nm)) {
        diff[i]++; diff[j]--;
        if (j > i) blockSpan.set(nm, Math.max(blockSpan.get(nm) || 0, segEnd[j] - segStart[i]));
      } else if (i !== j) deps.push({ name: nm, from: i, to: j });
    }
    const forbidden = new Array(S).fill(false);
    { let acc = 0; for (let g = 0; g < S; g++) { acc += diff[g]; forbidden[g] = acc > 0; } }

    // pack segments into chunks
    const chunkOfSeg = new Int32Array(S);
    const chunks = [];                               // {a, b} segment ranges
    let ca = 0, size = 0;
    for (let k = 0; k < S; k++) {
      const sz = segEnd[k] - segStart[k];
      if (k > ca && size + sz > target && !forbidden[k - 1]) { chunks.push({ a: ca, b: k - 1 }); ca = k; size = 0; }
      size += sz;
    }
    chunks.push({ a: ca, b: S - 1 });
    chunks.forEach((c, ci) => { for (let k = c.a; k <= c.b; k++) chunkOfSeg[k] = ci; });

    const imports = chunks.map(() => new Set()), exports_ = chunks.map(() => new Set());
    for (const d of deps) {
      const cf = chunkOfSeg[d.from], ct = chunkOfSeg[d.to];
      if (cf !== ct) { exports_[cf].add(d.name); imports[ct].add(d.name); }
    }

    const bodyOf = (a, b) => {                       // source text of segments a..b with envMode edits applied
      const from = segStart[a], to = segEnd[b];
      let out = '', pos = from;
      for (const ed of edits) {
        const inside = ed.s === ed.e ? (ed.s > from && ed.s <= to) : (ed.s >= from && ed.s < to);
        if (!inside) continue;
        out += src.slice(pos, ed.s) + ed.text; pos = ed.e;
      }
      return out + src.slice(pos, to);
    };

    let bigSeg = { size: 0, at: 0 };
    for (let k = 0; k < S; k++) if (segEnd[k] - segStart[k] > bigSeg.size) bigSeg = { size: segEnd[k] - segStart[k], at: segStart[k] };
    const bodies = chunks.map(c => bodyOf(c.a, c.b));

    return {
      count: chunks.length,
      hasTopReturnLast,
      envNames: [...converted],
      largest: Math.max(...bodies.map(x => x.length)),
      bigStmt: { size: bigSeg.size, snippet: src.substr(bigSeg.at, 40).replace(/\s+/g, ' ') },
      blockers: [...blockSpan.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(x => x[0]),
      chunks: chunks.map((c, ci) => ({
        body: bodies[ci],
        imports: [...imports[ci]],
        exports: [...exports_[ci]],
      })),
    };
  }

  // Builds the final script out of the obfuscated chunks.
  function assemble(outs, plan, id) {
    const key = '__rbxs_' + id;
    const env = plan.envNames && plan.envNames.length > 0;
    let head = `local __G=(getgenv and getgenv()) or _G\n__G["${key}"]={}\n`;
    if (env) {
      head += `local __E=(getfenv and getfenv()) or _G\nlocal __S=__G["${key}"]\n` +
        `local __C={${plan.envNames.map(n => `["${n}"]=true`).join(',')}}\n` +
        `local __sf=assert(setfenv,"setfenv is required by this build")\n` +
        `local __env=setmetatable({},{__index=function(_,k)local v=__S[k] if v~=nil then return v end return __E[k] end,` +
        `__newindex=function(_,k,v)if __C[k] then __S[k]=v else __E[k]=v end end})\n` +
        `local function __w(f)__sf(f,__env)return f end\n`;
    }
    const parts = [head];
    const last = outs.length - 1;
    outs.forEach((o, i) => {
      const wrap = env ? `__w(function(...)\n${o}\nend)(...)` : `(function(...)\n${o}\nend)(...)`;
      if (i === last && plan.hasTopReturnLast) parts.push(`local __r=table.pack(${wrap})\n__G["${key}"]=nil\nreturn table.unpack(__r,1,__r.n)\n`);
      else parts.push(`;${wrap}\n`);
    });
    if (!plan.hasTopReturnLast) parts.push(`__G["${key}"]=nil\n`);
    return parts.join('');
  }

  // Source text actually sent for a chunk (adds the by-value import / export glue).
  function chunkSource(ch, id) {
    const key = '__rbxs_' + id, v = '__s_' + id;
    let pre = '', post = '';
    if (ch.imports.length || ch.exports.length) pre += `local ${v}=(getgenv and getgenv() or _G)["${key}"]\n`;
    if (ch.imports.length) pre += `local ${ch.imports.join(',')}=${ch.imports.map(n => `${v}.${n}`).join(',')}\n`;
    if (ch.exports.length) post += '\n' + ch.exports.map(n => `${v}.${n}=${n}`).join('\n') + '\n';
    return pre + ch.body + post;
  }


  // ───────────────────── pipeline (browser) ─────────────────────
  export const cfg = {
    endpoint: '/api/protect',                      // same-origin proxy (api/protect.ts) → rbx.lol
    tiers: [150000, 80000, 40000, 20000, 10000],   // piece-size targets (chars), tried largest → smallest
    concurrency: 2,
    timeout: 120000,
    directLimit: 250000,                           // scripts up to this size are first sent whole
    tryWhole: true,
  };
  const SYNTAX_RE = /syntax|parse|unexpected|expected|unfinished|malformed|lex|unterminated/i;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const kb = n => Math.round(n / 1000);
  const ctl = { cancelled: false, requests: 0 };
  const hooks = { status() {}, progress() {} };
  const cache = new Map();                         // piece text → obfuscated output

  async function callProtect(source) {
    let last = { ok: false, error: 'Unknown error', syntax: false };
    for (let attempt = 0; attempt < 4; attempt++) {
      if (ctl.cancelled) return { ok: false, error: 'Cancelled', cancelled: true };
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), cfg.timeout);
      try {
        ctl.requests++;
        const res = await fetch(cfg.endpoint, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source }), signal: ac.signal,
        });
        let data = null;
        try { data = await res.json(); } catch (_) { /* non-JSON error page */ }
        if (res.ok && data && data.ok && typeof data.protected === 'string') return { ok: true, out: data.protected };
        const msg = (data && data.error) || `HTTP ${res.status}`;
        last = { ok: false, error: msg, status: res.status, syntax: !!(data && data.error && SYNTAX_RE.test(String(data.error))) };
        if (last.syntax) return last;
        if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
          hooks.status(`Server busy (HTTP ${res.status}), retrying…`);
          await sleep(2500 * (attempt + 1)); continue;
        }
        return last;
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, error: 'Request timed out', syntax: false };
        return { ok: false, network: true, syntax: false,
          error: `Could not reach ${cfg.endpoint}. The browser blocked the request (CORS) or you are offline - see "Blocked by CORS?" below.` };
      } finally { clearTimeout(timer); }
    }
    return last;
  }

  async function runChunks(texts, label) {
    const outs = new Array(texts.length);
    let next = 0, done = 0, failure = null;
    hooks.progress(0, texts.length);
    const worker = async () => {
      while (!failure) {
        const i = next++; if (i >= texts.length) return;
        if (cache.has(texts[i])) { outs[i] = cache.get(texts[i]); hooks.progress(++done, texts.length); continue; }
        hooks.status(`${label} · piece ${i + 1}/${texts.length} (${kb(texts[i].length)} KB)`);
        const r = await callProtect(texts[i]);
        if (!r.ok) { failure = Object.assign({ index: i }, r); return; }
        cache.set(texts[i], r.out); outs[i] = r.out; hooks.progress(++done, texts.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(cfg.concurrency, texts.length) }, worker));
    return failure ? { ok: false, failure } : { ok: true, outs };
  }

  // reads a size limit out of a server message such as "capped at 256 KB"
  function parseLimit(msg) {
    const m = /(\d[\d.,]*)\s*(kb|kib|k|mb|mib|m|bytes?|chars?|characters)\b/i.exec(String(msg || ''));
    if (!m) return 0;
    const v = parseFloat(m[1].replace(/,/g, ''));
    const u = m[2].toLowerCase();
    if (!isFinite(v) || v <= 0) return 0;
    if (u[0] === 'm') return v * 1e6;
    if (u[0] === 'k') return v * 1e3;
    return v;
  }

  export type ProtectOptions = { onStatus?: (text: string) => void; onProgress?: (done: number, total: number) => void; signal?: AbortSignal };
  export type ProtectResult = { ok: boolean; out?: string; error?: string; stats?: { input: number; compact: number; tables: number; pieces: number; requests: number; envMode: boolean } };

  export async function protectBig(source: string, opts: ProtectOptions = {}): Promise<ProtectResult> {
    hooks.status = opts.onStatus || (() => {});
    hooks.progress = opts.onProgress || (() => {});
    ctl.cancelled = false; ctl.requests = 0;
    if (opts.signal) { if (opts.signal.aborted) ctl.cancelled = true; else opts.signal.addEventListener('abort', () => { ctl.cancelled = true; }, { once: true }); }
    const stats = { input: source.length, compact: 0, tables: 0, pieces: 1, requests: 0, envMode: false };
    const finish = r => { stats.requests = ctl.requests; r.stats = stats; return r; };

    if (cfg.tryWhole && source.length <= cfg.directLimit) {
      hooks.status('Trying the whole script…');
      const r = await callProtect(source);
      if (r.ok) return finish({ ok: true, out: r.out });
      if (r.syntax || r.network || r.cancelled) return finish({ ok: false, error: r.error });
      hooks.status(`Server said "${r.error}" - switching to big-script mode…`);
    }

    hooks.status('Compacting…');
    let compact = stripComments(source);
    const sp = splitTables(compact, 40000);        // big keyed table (e.g. one entry per game) → one statement per entry
    if (sp.changed) compact = sp.src;
    stats.compact = compact.length; stats.tables = sp.changed;
    const id = Math.random().toString(36).slice(2, 8);
    const seen = new Set();
    let lastErr = 'The server rejected every piece size.', lastInfo = null, syntaxFails = 0, syntaxErr = null;
    let minFail = Infinity;                        // smallest request the server has already rejected
    const queue = cfg.tiers.slice();

    for (let qi = 0; qi < queue.length; qi++) {
      const target = queue[qi];
      const attempts = [];
      const mk = (plan, label) => ({ plan, texts: plan.chunks.map(c => chunkSource(c, id)), label });
      if (compact.length <= target) attempts.push({ plan: null, texts: [compact], label: 'Compacted', info: null });
      else {
        const p1 = planChunks(compact, target, false);
        attempts.push(Object.assign(mk(p1, `${p1.count} pieces ≈${kb(target)} KB`), { info: p1 }));
        if (p1.largest > target * 1.25) {          // splitting got blocked by shared state → try the env version too
          const p2 = planChunks(compact, target, true);
          if (p2.envNames.length && p2.largest < p1.largest * 0.8) attempts.push(Object.assign(mk(p2, `${p2.count} pieces ≈${kb(target)} KB (shared-state mode)`), { info: p2, env: true }));
        }
      }

      let restart = false;
      for (const at of attempts) {
        const sig = at.texts.map(t => t.length).join(',') + (at.env ? 'e' : '');
        if (seen.has(sig)) continue;
        seen.add(sig);
        if (Math.max(...at.texts.map(t => t.length)) >= minFail) continue;   // known to be too big, don't resend
        if (at.info) lastInfo = { target, largest: at.info.largest, count: at.info.count, blockers: at.info.blockers, bigStmt: at.info.bigStmt };

        const r = await runChunks(at.texts, at.label);
        if (r.ok) {
          stats.pieces = at.texts.length; stats.envMode = !!at.env;
          return finish({ ok: true, out: at.texts.length === 1 ? r.outs[0] : assemble(r.outs, at.plan, id) });
        }
        const f = r.failure;
        lastErr = f.error;
        if (f.cancelled || f.network) return finish({ ok: false, error: f.error });
        if (!f.syntax) minFail = Math.min(minFail, at.texts[f.index].length);
        if (f.syntax) {
          if (at.texts.length === 1) return finish({ ok: false, error: f.error });   // the script itself is invalid
          syntaxErr = `${f.error} (in piece ${f.index + 1} of ${at.texts.length})`;
          if (++syntaxFails >= 2) return finish({ ok: false, error: syntaxErr + ' - if your script runs fine, this is a splitting bug.' });
          continue;
        }
        const lim = parseLimit(f.error);           // server told us its limit → jump straight below it
        if (lim) {
          const t2 = Math.floor(lim * 0.85);
          if (t2 < target && t2 >= 2000 && !queue.includes(t2)) {
            queue.splice(qi + 1, queue.length, t2, ...cfg.tiers.filter(t => t < t2));
            restart = true; break;
          }
        }
      }
      if (restart) continue;
    }

    let msg = `The server still rejected it ("${lastErr}").`;
    if (syntaxErr) msg = `${syntaxErr}.`;
    if (lastInfo) {
      msg += ` Smallest split I could make: ${lastInfo.count} piece(s), largest ${kb(lastInfo.largest)} KB.`;
      if (lastInfo.blockers.length) msg += ` Shared variables pinning the code together: ${lastInfo.blockers.join(', ')}.`;
      if (lastInfo.bigStmt.size > 20000) msg += ` One single top-level statement is ${kb(lastInfo.bigStmt.size)} KB (starts "${lastInfo.bigStmt.snippet}") and cannot be split.`;
    }
    return finish({ ok: false, error: msg });
  }
