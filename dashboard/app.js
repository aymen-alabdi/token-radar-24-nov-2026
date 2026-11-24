// Token Radar's page. It reads window.RADAR from data.js, renders the board and the issued-token
// view, and recomputes every row's value from the four public constants so the code, the numbers and
// the screenshots visibly come from the same arithmetic. No network, no framework, no remote fonts.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var root = document.getElementById('board');
  var drawer = document.createElement('aside');
  drawer.className = 'detail';
  drawer.hidden = true;
  drawer.setAttribute('aria-label', 'Protocol detail');
  document.body.appendChild(drawer);

  var state = { view: 'radar', q: '', category: 'all', sort: 'implied', dir: -1, selected: null };
  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return money.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function age(days) {
    if (days === null || days === undefined) return 'unknown';
    return days >= 365 ? (days / 365).toFixed(1) + 'y' : Math.round(days) + 'd';
  }
  function sign(n) { return n > 0 ? '+' : n < 0 ? '\u2212' : ''; }

  // The model, re-run here from the constants the board was built with.
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function factors(row, m) {
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, m.growth_floor, m.growth_cap);
    var momentum = 1 + (growth / 100) * m.momentum_weight;
    var days = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var tenure = m.tenure_floor + (clamp(days, 0, m.tenure_days) / m.tenure_days) * m.tenure_span;
    var chains = Math.min(Math.max((row.chains || []).length - 1, 0), m.reach_max);
    var reach = 1 + chains * m.reach_step;
    return { growth: growth, base: row.tvl_usd * m.base, momentum: momentum, tenure: tenure, reach: reach,
      value: Math.max(1, Math.round(row.tvl_usd * m.base * momentum * tenure * reach)) };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (key) {
      var v = attrs[key];
      if (v === null || v === undefined) return;
      if (key === 'class') node.className = v;
      else if (key === 'text') node.textContent = v;
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), v);
      else node.setAttribute(key, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);
    if (p.get('v') === 'live' || p.get('v') === 'radar') state.view = p.get('v');
    if (p.get('q')) state.q = p.get('q');
    if (p.get('c') && p.get('c') !== 'all') state.category = p.get('c');
    if (p.get('s')) state.sort = p.get('s');
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.view !== 'radar') p.set('v', state.view);
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('c', state.category);
    if (state.sort !== 'implied') p.set('s', state.sort);
    if (state.selected) p.set('p', state.selected);
    var text = p.toString();
    window.history.replaceState(null, '', text ? '#' + text : window.location.pathname);
  }

  function categories() {
    var set = {};
    DATA.rows.forEach(function (r) { if (r.category) set[r.category] = true; });
    return Object.keys(set).sort();
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortRows(rows) {
    var key = state.sort;
    return rows.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'lift') { av = a.lift; bv = b.lift; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function headCell(label, key) {
    return el('th', {}, el('button', {
      'aria-sort-active': state.sort === key ? 'true' : 'false',
      onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); }
    }, label, state.sort === key ? (state.dir < 0 ? ' \u2193' : ' \u2191') : ''));
  }

  function topbar() {
    return el('header', { class: 'topbar' },
      el('div', { class: 'brand' }, el('span', { class: 'signal' }),
        el('div', {}, el('b', { text: 'Token Radar' }), el('small', { text: 'pre-token intelligence' }))),
      el('div', { class: 'topmeta' },
        el('span', {}, el('i'), ' ', 'live model'),
        el('span', { text: 'snapshot ' + DATA.as_of }),
        el('span', { text: DATA.model_version })),
    );
  }

  function hero() {
    var t = DATA.totals;
    return el('section', { class: 'hero' },
      el('div', {},
        el('span', { class: 'eyebrow', text: 'Before the token exists' }),
        el('h1', { text: 'The pre-token board' }),
        el('p', { class: 'lede', text:
          'A ranked screen of ' + t.protocols + ' protocols from the sealed ' + DATA.as_of + ' snapshot. ' +
          'The ' + t.watchlist + ' watchlist names set the floor; ' + t.early + ' smaller pre-token protocols are added from the same figures. ' +
          'Issued tokens stay in their own tab, with the market\u2019s own market cap, never a modelled value.' }),
      ),
      el('div', { class: 'metrics' },
        el('div', { class: 'metric' }, el('b', { text: String(t.protocols) }), el('small', { text: 'protocols scanned' })),
        el('div', { class: 'metric' }, el('b', {}, el('span', { text: String(t.watchlist) })), el('small', { text: 'on the watchlist' })),
        el('div', { class: 'metric' }, el('b', { text: String(t.rows) }), el('small', { text: t.early + ' early finds' })),
        el('div', { class: 'metric' }, el('b', { text: String(t.live) }), el('small', { text: 'live tokens set aside' }))),
    );
  }

  function formula() {
    var m = DATA.model;
    return el('div', { class: 'formula' },
      el('span', { class: 'tag', text: 'Value model' }),
      el('code', {},
        'TVL \u00d7 ' + m.base + ' \u00d7 [1 + ' + m.momentum_weight + ' \u00d7 clamp(7d, ' + m.growth_floor + ', ' + m.growth_cap + ')\u00f7100]',
        el('em', { text: ' \u00d7 ' }),
        '[' + m.tenure_floor + ' + ' + m.tenure_span + ' \u00d7 min(age, ' + m.tenure_days + ')\u00f7' + m.tenure_days + ']',
        el('em', { text: ' \u00d7 ' }),
        '[1 + ' + m.reach_step + ' \u00d7 min(chains\u22121, ' + m.reach_max + ')]'),
      el('span', { class: 'note', text: 'Same function in lib/model.ts and here' }));
  }

  function controls(count) {
    var cat = el('select', { onchange: function (e) { state.category = e.target.value; render(); } },
      el('option', { value: 'all', text: 'All categories' }));
    categories().forEach(function (c) { cat.appendChild(el('option', { value: c, text: c, selected: state.category === c ? 'selected' : null })); });
    cat.value = state.category;
    return el('div', { class: 'controls' },
      el('div', { class: 'tabs', role: 'tablist' },
        el('button', { role: 'tab', 'aria-selected': state.view === 'radar' ? 'true' : 'false', onclick: function () { state.view = 'radar'; render(); } }, 'Pre-token radar'),
        el('button', { role: 'tab', 'aria-selected': state.view === 'live' ? 'true' : 'false', onclick: function () { state.view = 'live'; render(); } }, 'Live tokens')),
      el('div', { class: 'field' }, el('label', { text: 'Search protocols or chains' }),
        el('input', { type: 'search', value: state.q, placeholder: 'e.g. lending, base, vault',
          oninput: function (e) { state.q = e.target.value; render(); } })),
      el('div', { class: 'field' }, el('label', { text: 'Category' }), cat),
      el('div', { class: 'count' }, el('b', { text: String(count) }), state.view === 'radar' ? ' ranked rows' : ' issued tokens')
    );
  }

  function boardTable(rows) {
    if (rows.length === 0) return el('div', { class: 'empty' }, el('b', { text: 'No protocol matches' }), 'Clear the search or pick another category.');
    var top = rows[0].implied_value_usd;
    var body = el('tbody');
    sortRows(rows).forEach(function (r) {
      var change = r.change_7d === null ? 0 : r.change_7d;
      var liftClass = r.lift > 0 ? 'up' : r.lift < 0 ? 'down' : 'flat';
      body.appendChild(el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        onclick: function () { state.selected = r.slug; writeHash(); render(); }
      },
        el('td', { class: 'rank' + (r.rank <= 3 ? ' top' : ''), text: String(r.rank) }),
        el('td', { class: 'protocol' }, el('b', { text: r.name }),
          r.on_watchlist ? el('span', { class: 'badge', text: 'WATCH' }) : null,
          el('span', { text: r.slug })),
        el('td', { class: 'cat', text: r.category || 'uncategorised' }),
        el('td', { class: 'num', text: usd(r.tvl_usd) }),
        el('td', { class: 'num ' + (change >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        el('td', { class: 'age', text: age(r.age_days) }),
        el('td', {}, el('div', { class: 'value' },
          el('b', { class: 'num', text: usd(r.implied_value_usd) }),
          el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / top) * 100)) + '%' })))),
        el('td', { class: 'lift ' + liftClass, text: (r.lift > 0 ? '+' : r.lift < 0 ? '\u2212' : '') + Math.abs(r.lift) }),
      ));
    });
    return el('div', { class: 'panel scroll' }, el('table', {},
      el('thead', {}, el('tr', {},
        headCell('#', 'rank'), el('th', { text: 'Protocol' }), el('th', { text: 'Category' }),
        headCell('TVL', 'tvl'), headCell('7d', 'growth'), headCell('Run', 'age'),
        headCell('Implied value', 'implied'), headCell('vs TVL', 'lift'))),
      body));
  }

  function liveTable() {
    var body = el('tbody');
    DATA.live.forEach(function (r, i) {
      body.appendChild(el('tr', {},
        el('td', { class: 'rank' + (i < 3 ? ' top' : ''), text: String(i + 1) }),
        el('td', { class: 'protocol' }, el('b', { text: r.name }), el('span', { text: r.slug })),
        el('td', { class: 'cat', text: r.category || 'uncategorised' }),
        el('td', { class: 'num', text: usd(r.tvl_usd) }),
        el('td', { class: 'num', text: usd(r.mcap_usd) }),
        el('td', { class: 'num ' + (r.multiple >= 1 ? 'neg' : 'pos'), text: r.multiple.toFixed(2) + '\u00d7' }),
        el('td', { class: 'num ' + (r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) })));
    });
    return el('div', { class: 'panel scroll' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', { text: '#' }), el('th', { text: 'Protocol' }),
        el('th', { text: 'Category' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }),
        el('th', { text: 'Cap / TVL' }), el('th', { text: '7d' }))),
      body));
  }

  function notes() {
    return el('section', { class: 'notes' },
      el('div', { class: 'note' }, el('h3', { text: '01 / Why value' }),
        el('p', { text: 'TVL is the only common measure of traction in the snapshot. The 7-day change adds momentum but is capped at \u221280% and +150% so one week cannot decide the board. ' }),
        el('p', { text: 'Tenure rewards time served with no token recorded: a longer run means more unrewarded activity. Multi-chain deployment adds a small breadth premium.' })),
      el('div', { class: 'note' }, el('h3', { text: '02 / How to read' }),
        el('p', {}, 'The ', el('code', { text: 'vs TVL' }), ' column is the TVL rank minus the value rank. A positive number means the model rates this protocol above where a TVL-only screen would put it; open a row to see every multiplier.'),
        el('p', { text: 'Watch-marked rows are the snapshot\u2019s 40-protocol floor. The board also carries early protocols below that floor, ranked by the same function.' })),
      el('div', { class: 'note' }, el('h3', { text: '03 / What it is not' }),
        el('p', { text: 'Implied value is this radar\u2019s own claim, not a forecast and not anyone else\u2019s valuation. A missing token field is DefiLlama\u2019s record, not proof that no token exists.' }),
        el('p', { text: 'The Live tokens tab holds protocols whose tokens do trade, with the market\u2019s own market cap. They are never scored or mixed into the board.' })));
  }

  function warning() {
    return el('div', { class: 'warning', text:
      'Farming carries risk: capital can be lost to contracts, bridge failures, price moves or a token that never arrives. Every plan below is a sequence of verifiable actions with a cash cost and a clock time, not a promise of a reward. Check the protocol\u2019s own pages before you act.' });
  }

  function detail(row) {
    var m = DATA.model;
    var f = factors(row, m);
    var chips = el('div', { class: 'chips' });
    if (row.on_watchlist) chips.appendChild(el('span', { class: 'chip gold', text: 'WATCHLIST' }));
    chips.appendChild(el('span', { class: 'chip', text: 'NO TOKEN RECORDED' }));
    (row.chains || []).slice(0, 5).forEach(function (c) { chips.appendChild(el('span', { class: 'chip', text: c })); });

    var eq = el('div', { class: 'equation' });
    [['TVL \u00d7 base', usd(f.base)],
      ['7d change (capped)', pct(f.growth)],
      ['momentum \u00d7', f.momentum.toFixed(3)],
      ['tenure \u00d7', f.tenure.toFixed(3)],
      ['chain reach \u00d7', f.reach.toFixed(3)],
      ['implied value', usd(Math.round(f.base * f.momentum * f.tenure * f.reach))],
      ['TVL rank / value rank', row.tvl_rank + ' / ' + row.rank],
      ['listed', row.listed_at || 'unknown']].forEach(function (pair) {
      eq.appendChild(el('div', {}, el('span', { text: pair[0] }), el('b', { text: pair[1] })));
    });

    var steps = el('ol', { class: 'steps' });
    (row.farm_steps || []).forEach(function (s, i) {
      var cut = s.lastIndexOf(' Cost: ');
      var action = cut > 0 ? s.slice(0, cut) : s;
      var tail = cut > 0 ? s.slice(cut + 1) : '';
      steps.appendChild(el('li', {}, action, el('b', { text: tail })));
    });

    drawer.replaceChildren(
      el('div', { class: 'detail-head' },
        el('div', {}, el('span', { class: 'eyebrow', text: 'Rank ' + row.rank + ' of ' + DATA.totals.rows }),
          el('h2', { text: row.name }), el('div', { class: 'slug', text: row.slug })),
        el('button', { class: 'close', onclick: function () { state.selected = null; writeHash(); render(); }, text: 'Close' })),
      chips,
      el('div', { class: 'headline' },
        el('div', {}, el('b', { text: usd(row.implied_value_usd) }), el('small', { text: 'implied value if the record holds' })),
        el('div', {}, el('b', { class: row.lift >= 0 ? 'pos' : 'neg', text: sign(row.lift) + Math.abs(row.lift) }), el('small', { text: 'places above TVL rank' }))),
      el('section', { class: 'section' }, el('h3', { text: 'How the number is made' }), eq),
      el('section', { class: 'section' }, el('h3', { text: 'Farm plan \u2014 7 steps' }), steps),
      el('p', { class: 'caveat', text: 'No protocol name is special-cased. This plan comes from the protocol\u2019s category, chains, TVL and tracking date; the cash figures scale with its own TVL. Always confirm current contracts and rewards on the protocol\u2019s own site.' }),
    );
    drawer.hidden = false;
  }

  function render() {
    readHash();
    var rows = filtered();
    var selected = state.selected ? DATA.rows.find(function (r) { return r.slug === state.selected; }) : null;
    root.replaceChildren(
      topbar(),
      hero(),
      formula(),
      controls(rows.length),
      state.view === 'radar' ? boardTable(rows) : liveTable(),
      notes(),
      warning(),
    );
    if (selected) detail(selected);
    else { drawer.hidden = true; drawer.replaceChildren(); }
    root.setAttribute('aria-busy', 'false');
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; writeHash(); render(); }
  });
  window.addEventListener('hashchange', render);
  render();
})();
