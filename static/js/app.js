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

  /* ---------- Дорожная карта ---------- */
  let roadmap = null;
  const rmChecked = new Set(JSON.parse(localStorage.getItem("zezar-rm-checked") || "[]"));
  let rmFilter = "all";
  let rmSort = "chrono";
  let rmConfettiFired = false;

  const STATUS_META = {
    done:    { label: "Завершён",   cls: "done" },
    active:  { label: "В работе",   cls: "active" },
    planned: { label: "Планируется", cls: "planned" },
    idea:    { label: "Идея",       cls: "idea" },
  };

  function goalDone(phase, goal) {
    return goal.done === true || rmChecked.has(phase.id + "/" + goal.id);
  }

  function phaseProgress(phase) {
    if (!phase.goals.length) return 0;
    return Math.round(100 * phase.goals.filter(g => goalDone(phase, g)).length / phase.goals.length);
  }

  function saveRmChecked() {
    localStorage.setItem("zezar-rm-checked", JSON.stringify([...rmChecked]));
  }

  function celebrate() {
    const box = document.getElementById("rmTimeline");
    if (!box) return;
    for (let i = 0; i < 26; i++) {
      const s = document.createElement("span");
      s.className = "confetti";
      s.style.left = (5 + Math.random() * 90) + "%";
      s.style.background = ["#6d5cff", "#00c2ff", "#ffb020", "#22c55e", "#ec4899"][i % 5];
      s.style.animationDelay = (Math.random() * 0.4) + "s";
      s.style.animationDuration = (1.1 + Math.random()) + "s";
      box.appendChild(s);
      setTimeout(() => s.remove(), 2200);
    }
  }

  function renderRoadmap() {
    const timeline = document.getElementById("rmTimeline");
    if (!roadmap) {
      timeline.innerHTML = '<div class="empty-hint">Дорожная карта недоступна: нет файла <code>roadmap.json</code></div>';
      return;
    }
    let phases = roadmap.phases.map(p => ({ ...p, progress: phaseProgress(p) }));

    // фильтр по статусу этапа (готовые этапы видны в любом фильтре, кроме «все»)
    if (rmFilter !== "all") {
      phases = phases.filter(p =>
        p.progress === 100 ? (rmFilter === "done") :
        rmFilter === "active" ? (p.status === "active" && p.progress < 100) :
        rmFilter === "planned" ? (p.status !== "active" && p.progress < 100) :
        true
      );
    }
    if (rmSort === "progress") phases.sort((a, b) => b.progress - a.progress);

    timeline.innerHTML = "";
    if (!phases.length) {
      timeline.innerHTML = '<div class="empty-hint">Нет этапов под выбранный фильтр</div>';
    }

    phases.forEach((phase, idx) => {
      const card = document.createElement("article");
      card.className = "rm-card reveal st-" + (STATUS_META[phase.status]?.cls || "planned");
      card.dataset.phase = phase.id;

      const doneCount = phase.goals.filter(g => goalDone(phase, g)).length;
      const sm = STATUS_META[phase.status] || STATUS_META.planned;
      const isFinished = phase.progress === 100;

      card.innerHTML =
        '<div class="rm-node">' + (isFinished ? "✓" : idx + 1) + "</div>" +
        '<div class="rm-card-body">' +
          '<div class="rm-card-head">' +
            '<div class="rm-phase-icon">' + (phase.icon || "🧭") + "</div>" +
            '<div class="rm-card-titles">' +
              "<h3>" + esc(phase.name) + "</h3>" +
              '<p class="rm-tagline">' + esc(phase.tagline || "") + "</p>" +
            "</div>" +
            '<div class="rm-badges">' +
              '<span class="rm-badge period">🗓 ' + esc(phase.period || "") + "</span>" +
              '<span class="rm-badge status ' + sm.cls + '">' + (isFinished ? "🏁 Завершён" : sm.label) + "</span>" +
            "</div>" +
          "</div>" +
          '<div class="rm-progress-row">' +
            '<div class="rm-bar"><i style="width:' + phase.progress + '%"></i></div>' +
            '<span class="rm-pct">' + phase.progress + "%</span>" +
          "</div>" +
        "</div>";

      // интерактивные отметки
      card.querySelectorAll(".rm-goals li").forEach(li => {
        const btn = li.querySelector(".rm-check");
        if (btn.disabled) return;
        btn.addEventListener("click", () => {
          const key = phase.id + "/" + li.dataset.goal;
          const nowChecked = !rmChecked.has(key);
          nowChecked ? rmChecked.add(key) : rmChecked.delete(key);
          saveRmChecked();
          li.classList.toggle("checked", nowChecked);
          btn.setAttribute("aria-pressed", nowChecked);
          btn.textContent = nowChecked ? "✓" : "";
          updateRoadmapStats();
          if (phaseProgress(phase) === 100 && !rmConfettiFired) {
            rmConfettiFired = true;
            celebrate();
          }
        });
      });

      timeline.appendChild(card);
      requestAnimationFrame(() => card.classList.add("shown"));
    });

    updateRoadmapStats();
  }

  function updateRoadmapStats() {
    if (!roadmap) return;
    const allGoals = roadmap.phases.flatMap(p => p.goals.map(g => goalDone(p, g)));
    const done = allGoals.filter(Boolean).length;
    const total = allGoals.length;
    const pct = total ? Math.round(100 * done / total) : 0;

    animateNumber(document.getElementById("rmStatDone"), done);
    document.getElementById("rmStatTotal").textContent = total;
    document.getElementById("rmStatPct").textContent = pct + "%";
    document.getElementById("rmBigbarFill").style.width = pct + "%";

    const dots = document.getElementById("rmPhaseDots");
    dots.innerHTML = roadmap.phases.map(p => {
      const pr = phaseProgress(p);
      return '<span class="rm-dot ' + (pr === 100 ? "full" : pr > 0 ? "part" : "") +
        '" title="' + esc(p.name) + ": " + pr + '%"></span>';
    }).join("");
  }

  function animateNumber(el, to) {
    const from = parseInt(el.textContent, 10);
    const start = Number.isFinite(from) ? from : 0;
    if (start === to) { el.textContent = to; return; }
    const t0 = Date.now();
    (function step() {
      const k = Math.min(1, (Date.now() - t0) / 450);
      el.textContent = Math.round(start + (to - start) * k);
      if (k < 1) requestAnimationFrame(step);
      else el.textContent = to;
    })();
  }

  document.getElementById("rmFilters").addEventListener("click", e => {
    const chip = e.target.closest("[data-filter]");
    if (!chip) return;
    rmFilter = chip.dataset.filter;
    document.querySelectorAll("#rmFilters .rm-chip").forEach(c => c.classList.toggle("active", c === chip));
    renderRoadmap();
  });

  document.getElementById("rmSort").addEventListener("click", e => {
    const chip = e.target.closest("[data-sort]");
    if (!chip) return;
    rmSort = chip.dataset.sort;
    document.querySelectorAll("#rmSort .rm-chip").forEach(c => c.classList.toggle("active", c === chip));
    renderRoadmap();
  });

  document.getElementById("rmResetBtn").addEventListener("click", () => {
    rmChecked.clear();
    rmConfettiFired = false;
    saveRmChecked();
    renderRoadmap();
  });

  async function loadRoadmap() {
    try {
      const resp = await fetch("roadmap.json", { cache: "no-store" });
      if (resp.ok) roadmap = await resp.json();
    } catch (e) { console.error("Не удалось загрузить дорожную карту:", e); }
  }

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

    // Ссылки на статьи документации (.md-перекрёстки) и внешние ссылки
    decorateDocLinks(container);

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

  /* ---------- Ссылки на статьи документации ----------
     Поддержка форматов: [Текст](INSTRUCTION_USER.md), ./DEPLOY#..., #docs/<id>,
     а также "ГЛАВНАЯ" / "/" — внутренняя навигация SPA без перезагрузки. */
  const DOC_ID_ALIASES = {}; // имя файла без расширения -> id статьи (заполняется при загрузке контента)

  function resolveDocHref(href) {
    if (!href || href.startsWith("http") || href.startsWith("mailto")) return null;
    if (href === "#docs/" || href === "docs") return "#docs";
    let m = href.match(/^#docs\/(.+)$/);
    if (m) return "#docs/" + m[1];
    if (/^(ГЛАВНАЯ|Главная|главная)$/.test(href)) return "#home";
    if (href === "/") return "#home";
    m = href.match(/^(?:\.\/)?(?:docs\/)?([A-Za-z0-9_-]+?)(?:\.md)?(?:#.*)?$/i);
    if (m) {
      const key = m[1].toUpperCase();
      if (DOC_ID_ALIASES[key]) return "#docs/" + DOC_ID_ALIASES[key];
    }
    return null;
  }

  function decorateDocLinks(container) {
    container.querySelectorAll("a[href]").forEach(a => {
      const target = resolveDocHref(a.getAttribute("href"));
      if (target) {
        a.setAttribute("href", target);
        a.classList.add("doc-crosslink");
      } else if (!a.getAttribute("href").startsWith("#")) {
        a.target = "_blank";
        a.rel = "noopener";
      }
    });
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
    } else if (page === "roadmap") {
      showPage("roadmap");
      renderRoadmap();
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
      // Алиасы для перекрёстных ссылок вида [Текст](INSTRUCTION_USER.md)
      docs.forEach(d => { DOC_ID_ALIASES[String(d.id).toUpperCase()] = d.id; });
    } catch (e) {
      docs = [];
      news = [];
      console.error("Не удалось загрузить контент сайта:", e);
    }
    await loadRoadmap();
    renderHomePreview();
    route();
  }

  loadContent();
})();
