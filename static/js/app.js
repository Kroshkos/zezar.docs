/* ============================================================
   Логика сайта Zezar: SPA-навигация, рендеринг документации
   и новостей из Markdown (content.json), поиск (Ctrl+K),
   тёмная тема, оглавление статьи, копирование кода, анимации.

   Контент генерируется при деплое скриптом build/content-gen.mjs
   из папок docs/*.md и news/*.md репозитория zezar.docs.
   ============================================================ */

(function () {
  "use strict";

  const pages = document.querySelectorAll(".page");
  const navLinks = document.querySelectorAll(".main-nav .nav-link");
  const burgerBtn = document.getElementById("burgerBtn");
  const mainNav = document.getElementById("mainNav");
  const header = document.getElementById("siteHeader");
  const progressBar = document.getElementById("readingProgress");
  const toTopBtn = document.getElementById("toTopBtn");

  let docs = [];
  let news = [];

  /* ---------- Тема (светлая/тёмная) ---------- */
  const themeBtn = document.getElementById("themeBtn");
  const savedTheme = localStorage.getItem("zezar-theme") ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = savedTheme;
  themeBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("zezar-theme", next);
  });

  /* ---------- Навигация между страницами ---------- */
  function showPage(pageId) {
    pages.forEach(p => p.classList.toggle("active", p.id === pageId));
    navLinks.forEach(a =>
      a.classList.toggle("active", a.getAttribute("href") === "#" + pageId)
    );
    mainNav.classList.remove("open");
    burgerBtn.classList.remove("open");
  }

  function currentPageId() {
    return location.hash.replace("#", "") || "home";
  }

  // Бургер-меню (мобильная версия)
  burgerBtn.addEventListener("click", () => {
    mainNav.classList.toggle("open");
    burgerBtn.classList.toggle("open");
  });

  /* ---------- Экранирование (fallback для сырого markdown) ---------- */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function bodyOf(item) {
    // html приходит из content.json (сгенерирован marked из Markdown);
    // если его нет — показываем исходный markdown как preformatted-текст.
    if (item.html) return item.html;
    return "<pre>" + esc(item.markdown || "") + "</pre>";
  }

  /* ---------- Улучшения отрендеренного контента ---------- */
  function enhanceArticle(container) {
    container.classList.add("markdown-body");

    // Заголовкам h2/h3 — id для якорей и оглавления справа
    const heads = container.querySelectorAll("h2, h3");
    heads.forEach((h, i) => {
      if (!h.id) {
        h.id = "sec-" + i + "-" + (h.textContent.trim().toLowerCase()
          .replace(/[^\w\u0430-\u044fё-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || i);
      }
    });

    // Внешние ссылки — в новой вкладке
    container.querySelectorAll("a[href^='http']").forEach(a => {
      a.target = "_blank";
      a.rel = "noopener";
    });

    // Кнопка «копировать» у блоков кода
    container.querySelectorAll("pre").forEach(pre => {
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.textContent = "Копировать";
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(pre.innerText.replace(/^Копировать|Скопировано/g, "").trim())
          .then(() => {
            btn.textContent = "Скопировано ✓";
            setTimeout(() => (btn.textContent = "Копировать"), 1500);
          });
      });
      pre.appendChild(btn);
    });

    buildTocRight(container);
  }

  /* ---------- Оглавление «На этой странице» ---------- */
  const tocRight = document.getElementById("tocRight");
  const tocRightList = document.getElementById("tocRightList");

  function buildTocRight(container) {
    const heads = container.querySelectorAll("h2, h3");
    tocRightList.innerHTML = "";
    tocRight.hidden = heads.length < 2;
    if (!tocRight.hidden) {
      heads.forEach(h => {
        const li = document.createElement("li");
        li.className = h.tagName === "H3" ? "lvl-3" : "lvl-2";
        const a = document.createElement("a");
        a.href = "#" + h.id;
        a.textContent = h.textContent;
        a.addEventListener("click", e => {
          e.preventDefault();
          h.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        li.appendChild(a);
        tocRightList.appendChild(li);
      });
    }
  }

  /* ---------- Документация ---------- */
  const docsToc = document.getElementById("docsToc");
  const docsContent = document.getElementById("docsContent");
  const docsFilter = document.getElementById("docsFilter");

  function renderDocs(activeId) {
    docsToc.innerHTML = "";
    if (!docs.length) {
      docsToc.innerHTML = '<div class="empty-hint">Пока нет статей в <code>docs/</code></div>';
      docsContent.innerHTML = "<h1>Документация</h1><p>Раздел заполняется автоматически из папки " +
        "<code>docs/</code> репозитория <strong>zezar.docs</strong>: добавьте туда файл <code>имя.md</code>, " +
        "и он появится здесь после push и деплоя.</p>";
      docsContent.classList.add("markdown-body");
      return;
    }
    docs.forEach(d => {
      const a = document.createElement("a");
      a.href = "#docs/" + d.id;
      a.textContent = d.title;
      a.dataset.docId = d.id;
      if (d.id === activeId) a.classList.add("active");
      docsToc.appendChild(a);
    });
    const doc = docs.find(d => d.id === activeId) || docs[0];
    docsContent.className = "docs-content article-panel";
    docsContent.innerHTML = "<h1>" + esc(doc.title) + "</h1>" + bodyOf(doc);
    enhanceArticle(docsContent);
    markActiveTocLink(doc.id);
    applyDocsFilter();
  }

  function markActiveTocLink(id) {
    docsToc.querySelectorAll("a").forEach(a =>
      a.classList.toggle("active", a.dataset.docId === id)
    );
  }

  function applyDocsFilter() {
    const q = docsFilter.value.trim().toLowerCase();
    docsToc.querySelectorAll("a").forEach(a => {
      a.style.display = a.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  }
  docsFilter.addEventListener("input", applyDocsFilter);

  docsToc.addEventListener("click", e => {
    const link = e.target.closest("a[data-doc-id]");
    if (!link) return;
    e.preventDefault();
    location.hash = "#docs/" + link.dataset.docId;
  });

  /* ---------- Новости ---------- */
  const newsList = document.getElementById("newsList");
  const newsContent = document.getElementById("newsContent");

  function formatDate(iso) {
    const months = ["января", "февраля", "марта", "апреля", "мая", "июня",
      "июля", "августа", "сентября", "октября", "ноября", "декабря"];
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }

  function sortedNews() {
    return [...news].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  function renderNews(activeId) {
    const sorted = sortedNews();
    newsList.innerHTML = "";
    if (!sorted.length) {
      newsList.innerHTML = '<div class="empty-hint">Пока нет новостей в <code>news/</code></div>';
      newsContent.innerHTML = "<h1>Новости</h1><p>Раздел наполняется автоматически из папки " +
        "<code>news/</code> репозитория <strong>zezar.docs</strong>: положите туда файл " +
        "<code>год-месяц-заголовок.md</code>.</p>";
      newsContent.classList.add("markdown-body");
      return;
    }
    sorted.forEach(n => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.innerHTML = esc(n.title) +
        '<span class="item-date">' + formatDate(n.date) + "</span>";
      btn.dataset.newsId = n.id;
      if (n.id === activeId) btn.classList.add("active");
      btn.addEventListener("click", () => { location.hash = "#news/" + n.id; });
      li.appendChild(btn);
      newsList.appendChild(li);
    });

    const article = sorted.find(n => n.id === activeId) || sorted[0];
    newsContent.className = "news-content article-panel";
    newsContent.innerHTML =
      "<h1>" + esc(article.title) + "</h1>" +
      '<div class="article-meta">' +
        (article.tag ? '<span class="tag">' + esc(article.tag) + "</span>" : "") +
        "<span>📅 " + formatDate(article.date) + "</span>" +
      "</div>" +
      bodyOf(article);
    enhanceArticle(newsContent);
    newsList.querySelectorAll("button").forEach(b =>
      b.classList.toggle("active", b.dataset.newsId === article.id)
    );
  }

  /* ---------- Превью новостей на главной ---------- */
  function renderHomePreview() {
    const preview = document.getElementById("homeNewsPreview");
    preview.innerHTML = "";
    sortedNews().slice(0, 3).forEach(n => {
      const li = document.createElement("li");
      li.className = "reveal";
      li.innerHTML =
        '<a href="#news/' + n.id + '">' + esc(n.title) + "</a>" +
        '<span class="preview-date">' + formatDate(n.date) + "</span>";
      preview.appendChild(li);
      requestAnimationFrame(() => li.classList.add("shown"));
    });
  }

  /* ---------- Модальный поиск (Ctrl+K) ---------- */
  const searchModal = document.getElementById("searchModal");
  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");
  const searchBtn = document.getElementById("searchBtn");
  let selectedIdx = -1;

  function openSearch() {
    searchModal.hidden = false;
    searchInput.value = "";
    searchResults.innerHTML = "";
    setTimeout(() => searchInput.focus(), 30);
  }
  function closeSearch() { searchModal.hidden = true; }

  searchBtn.addEventListener("click", openSearch);
  searchModal.querySelector("[data-close]").addEventListener("click", closeSearch);

  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      searchModal.hidden ? openSearch() : closeSearch();
    }
    if (e.key === "Escape" && !searchModal.hidden) closeSearch();
    if (searchModal.hidden) return;
    const items = searchResults.querySelectorAll(".search-result");
    if (e.key === "ArrowDown") { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, items.length - 1); highlight(items); }
    if (e.key === "ArrowUp") { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); highlight(items); }
    if (e.key === "Enter" && items[selectedIdx]) items[selectedIdx].click();
  });

  function highlight(items) {
    items.forEach((el, i) => el.classList.toggle("selected", i === selectedIdx));
  }

  function plainText(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || "";
  }

  function snippetAround(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return text.slice(0, 120) + "…";
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + query.length + 80);
    return (start > 0 ? "…" : "") +
      esc(text.slice(start, idx)) +
      "<mark class='search-hit'>" + esc(text.slice(idx, idx + query.length)) + "</mark>" +
      esc(text.slice(idx + query.length, end)) + (end < text.length ? "…" : "");
  }

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim();
    searchResults.innerHTML = "";
    selectedIdx = -1;
    if (q.length < 2) return;
    const lq = q.toLowerCase();
    const hits = [];
    for (const d of docs) {
      const text = plainText(d.html || d.markdown || "");
      if (d.title.toLowerCase().includes(lq) || text.toLowerCase().includes(lq)) {
        hits.push({ kind: "Документация", title: d.title, text, hash: "#docs/" + d.id });
      }
    }
    for (const n of news) {
      const text = plainText(n.html || n.markdown || "");
      if (n.title.toLowerCase().includes(lq) || text.toLowerCase().includes(lq)) {
        hits.push({ kind: "Новость", title: n.title, text, hash: "#news/" + n.id });
      }
    }
    if (!hits.length) {
      searchResults.innerHTML = '<div class="search-empty">Ничего не найдено по запросу «' + esc(q) + "»</div>";
      return;
    }
    hits.slice(0, 12).forEach(h => {
      const a = document.createElement("a");
      a.className = "search-result";
      a.href = h.hash;
      a.innerHTML =
        '<div class="sr-kind">' + esc(h.kind) + "</div>" +
        '<div class="sr-title">' + esc(h.title) + "</div>" +
        '<div class="sr-snippet">' + snippetAround(h.text, q) + "</div>";
      a.addEventListener("click", () => closeSearch());
      searchResults.appendChild(a);
    });
  });

  /* ---------- Скролл-эффекты: прогресс, тень шапки, «наверх», TOC ---------- */
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - innerHeight;
    progressBar.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";
    header.classList.toggle("scrolled", y > 8);
    toTopBtn.classList.toggle("visible", y > 500);

    // Подсветка активного пункта правого оглавления
    if (!tocRight.hidden) {
      const links = tocRightList.querySelectorAll("a");
      let current = null;
      links.forEach(a => {
        const el = document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)));
        if (el && el.getBoundingClientRect().top <= 120) current = a;
      });
      links.forEach(a => a.classList.toggle("current", a === current));
    }
  }, { passive: true });

  toTopBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  /* ---------- Маршрутизация по hash ----------
     Форматы: #home | #docs | #docs/<id> | #news | #news/<id> */
  function route() {
    const raw = currentPageId();
    const [page, subId] = raw.split("/");

    if (page === "docs") {
      showPage("docs");
      renderDocs(subId);
    } else if (page === "news") {
      showPage("news");
      renderNews(subId);
    } else {
      showPage("home");
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  window.addEventListener("hashchange", route);

  /* ---------- Загрузка контента и старт ---------- */
  async function loadContent() {
    try {
      const resp = await fetch("content.json", { cache: "no-store" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      docs = data.docs || [];
      news = data.news || [];
    } catch (e) {
      docs = [];
      news = [];
      console.error("Не удалось загрузить контент сайта:", e);
    }
    renderHomePreview();
    route();
  }

  loadContent();
})();
