# Zezar — сайт документации и новостей

Статический сайт проекта «ЦЕЗАРЬ» ([Zezar](https://github.com/Kroshkos/Zezar)):
документация и новости подгружаются с Markdown-файлов из этого репозитория.

## Структура

```
news/               ← НОВОСТИ: каждый .md — статья в разделе «Новости»
docs/               ← ДОКУМЕНТАЦИЯ: каждый .md — статья в разделе «Документация»
static/             ← сам сайт (index.html, css/, js/) + генерируемый content.json
content_site.py     ← генератор: собирает все .md в static/content.json
requirements.txt    ← python-markdown (для рендера Markdown → HTML при деплое)
amvera.yaml         ← конфигурация деплоя на Amvera
```

## Как добавить новость или статью документации

1. Положите файл в `news/` или `docs/` (имя файла — латиницей, напр. `2026-11-release.md`);
2. В начале файла — необязательный YAML front matter:

```markdown
---
title: Название статьи для сайта
date: 2026-11-01        # ISO; по умолчанию — дата изменения файла
tag: Release            # метка новости
order: 10               # только для docs: порядок в оглавлении (меньше = выше)
---

Текст в Markdown: заголовки, списки, таблицы, ```код```...
```

3. Сделайте push в `main` — Amvera соберёт `content.json` и обновит сайт.

Локально пересобрать контент: `python3 content_site.py`.

## Деплой на Amvera

Проект — статическое браузерное приложение (профиль Node.JS Browser): nginx
раздаёт содержимое `static/`, а перед запуском выполняется `pre_start` —
установка `markdown` и запуск `content_site.py`. Настройка вебхуков GitHub
описана в [docs.amvera.ru](https://docs.amvera.ru/applications/git/webhooks.html).
