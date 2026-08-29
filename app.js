// PTT 文章追蹤器 — frontend script
// Extracted from index.html so a strict CSP (script-src 'self') can be applied.
// No external dependencies, no UI framework.

(function () {
  'use strict';

  // Demo data shown when API has no results or is unreachable
  var DEMO_ARTICLES = [
    {
      title: '【心得】Mac mini M4 開箱分享',
      author: 'applefans',
      date: '03/27',
      pushes: 87,
      board: 'MacShop',
      url: 'https://www.ptt.cc/bbs/MacShop/M.1234567890.A.html'
    },
    {
      title: '[情報] iPhone 15 Pro Max 降價資訊整理',
      author: 'deallin',
      date: '03/26',
      pushes: 52,
      board: 'MobileComm',
      url: 'https://www.ptt.cc/bbs/MobileComm/M.1234567891.A.html'
    },
    {
      title: '[熱門] Stock 美股今晚暴跌 500 點',
      author: 'stockking',
      date: '03/27',
      pushes: 120,
      board: 'Stock',
      url: 'https://www.ptt.cc/bbs/Stock/M.1234567892.A.html'
    }
  ];

  // Initialize with demo data so page is never blank even before first fetch
  var allData = { hotArticles: DEMO_ARTICLES, keywordMatches: [] };
  var currentTab = 'all';

  function fetchArticles() {
    var btn = document.getElementById('refreshBtn');
    var status = document.getElementById('status');
    btn.disabled = true;
    status.textContent = '⏳ 載入中…';
    status.className = 'status';

    fetch('/api/tracker')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.success) throw new Error(data.error || '載入失敗');

        allData = {
          hotArticles: data.hotArticles || [],
          keywordMatches: data.keywordMatches || []
        };

        var time = new Date(data.timestamp).toLocaleString('zh-TW');
        status.textContent = '✅ 更新時間：' + time + '　🔥 ' + allData.hotArticles.length + ' 篇　🎯 ' + allData.keywordMatches.length + ' 篇命中';
        status.className = 'status';
        renderList();
      })
      .catch(function () {
        // Show demo data on error so the UI is never blank
        allData = { hotArticles: DEMO_ARTICLES, keywordMatches: [] };
        status.textContent = '⚠️ 無法連線 PTT（顯示示範資料）';
        status.className = 'status';
        renderList();
      })
      .then(function () {
        btn.disabled = false;
      });
  }

  function showTab(tab) {
    currentTab = tab;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.remove('active');
      tabs[i].setAttribute('aria-selected', 'false');
    }
    var active = document.getElementById(tab === 'all' ? 'tabAll' : 'tabKeyword');
    active.classList.add('active');
    active.setAttribute('aria-selected', 'true');
    renderList();
  }

  function articleEmoji(pushes) {
    if (pushes >= 50) return '🔥';
    if (pushes >= 20) return '📈';
    if (pushes > 0) return '🆕';
    return '📝';
  }

  // Build a single article element with structured DOM.
  // All user-derived values are written via textContent / safe attributes
  // so no <script> / HTML in article content can ever execute.
  function buildArticleElement(a) {
    var article = document.createElement('div');
    article.className = 'article';

    var header = document.createElement('div');
    header.className = 'article-header';

    var emoji = document.createElement('span');
    emoji.className = 'emoji';
    emoji.textContent = articleEmoji(a.pushes);

    var board = document.createElement('span');
    board.className = 'board';
    board.textContent = a.board || '';

    var pushes = document.createElement('span');
    pushes.className = 'pushes';
    pushes.textContent = '推 ' + (a.pushes || 0);

    header.appendChild(emoji);
    header.appendChild(board);
    header.appendChild(pushes);

    var titleWrap = document.createElement('div');
    titleWrap.className = 'article-title';
    var titleLink = document.createElement('a');
    titleLink.href = a.url || '#';
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.textContent = a.title || '';
    titleWrap.appendChild(titleLink);

    var meta = document.createElement('div');
    meta.className = 'article-meta';
    meta.textContent = '作者：' + (a.author || '未知') + ' 　|　 日期：' + (a.date || '');

    var readLink = document.createElement('a');
    readLink.className = 'article-link';
    readLink.href = a.url || '#';
    readLink.target = '_blank';
    readLink.rel = 'noopener noreferrer';
    readLink.textContent = '→ PTT 閱讀';

    article.appendChild(header);
    article.appendChild(titleWrap);
    article.appendChild(meta);
    article.appendChild(readLink);
    return article;
  }

  // Build the "empty" placeholder as structured DOM (no innerHTML).
  function buildEmptyElement() {
    var empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '目前沒有文章，點擊「刷新」載入最新內容';
    return empty;
  }

  function renderList() {
    var list = currentTab === 'all' ? allData.hotArticles : allData.keywordMatches;
    var el = document.getElementById('articleList');
    // Clear previous children safely (no innerHTML wipe needed).
    while (el.firstChild) el.removeChild(el.firstChild);

    if (!list || list.length === 0) {
      el.appendChild(buildEmptyElement());
      return;
    }
    var frag = document.createDocumentFragment();
    for (var i = 0; i < list.length; i++) {
      frag.appendChild(buildArticleElement(list[i]));
    }
    el.appendChild(frag);
  }

  // Wire up event listeners once the DOM is parsed.
  // (DOMContentLoaded has already fired if this script is loaded with
  //  defer or placed at end-of-body; we guard anyway for safety.)
  function init() {
    var refresh = document.getElementById('refreshBtn');
    if (refresh) refresh.addEventListener('click', fetchArticles);

    var tabAll = document.getElementById('tabAll');
    var tabKeyword = document.getElementById('tabKeyword');
    if (tabAll) tabAll.addEventListener('click', function () { showTab('all'); });
    if (tabKeyword) tabKeyword.addEventListener('click', function () { showTab('keyword'); });

    // Initial render immediately so page isn't blank on load.
    renderList();

    // Auto-load on page open.
    fetchArticles();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();