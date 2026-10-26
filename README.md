# Zezar — сайт документации и новостей

Статический сайт проекта «ЦЕЗАРЬ» ([Zezar](https://github.com/Kroshkos/Zezar)):
документация и новости подгружаются с Markdown-файлов из этого репозитория.


## Структура

```
news/               ← НОВОСТИ: каждый .md — статья в разделе «Новости»
docs/               ← ДОКУМЕНТАЦИЯ: каждый .md — статья в разделе «Документация»
build/content-gen.mjs ← генератор: собирает все .md в static/content.json (запускается при сборке)
static/             ← сам сайт (index.html, css/, js/) + content.json
package.json        ← npm-скрипт build (Node.JS Browser профиль Amvera)
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

Локально пересобрать контент: `npm install && npm run build`.

## Деплой на Amvera

Профиль **Node.JS Browser** (https://docs.amvera.ru/applications/environments/nodejs-browser.html):
при сборке Amvera выполняет `npm install && npm run build` — скрипт build
генерирует `static/content.json` из Markdown-папок; затем nginx раздаёт
содержимое `static/` (задано через `build.artifacts: {"static/*": /}`).
Секции `pre_start` в конфиге нет — её не поддерживает Amvera, вся подготовка
контента идёт штатной npm-командой сборки.

Настройка привязки GitHub и вебхуков: https://docs.amvera.ru/applications/git/webhooks.html
