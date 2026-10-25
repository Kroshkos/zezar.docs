/**
 * Генератор контента сайта документации и новостей «ЦЕЗАРЬ».
 *
 * Схема (пожелание владельца проекта):
 *   news/<файл>.md  — новости, подгружаются в раздел «Новости»;
 *   docs/<файл>.md  — документация, подгружается в раздел «Документация».
 *
 * Скрипт запускается командой `npm run build` во время сборки Amvera
 * (профиль Node.JS Browser выполняет `npm install && npm run build`,
 * затем nginx раздаёт артефакты из static/). Результат — static/content.json,
 * который читает фронтенд (static/js/app.js).
 *
 * Формат файла: необязательный YAML-фронтматтер между строками `---`,
 * затем Markdown-текст. Поля фронтматтера (все необязательные):
 *   title: Заголовок статьи   (по умолчанию — имя файла без расширения)
 *   date: 2026-10-25           (ISO; по умолчанию — mtime файла)
 *   order: 10                  (сортировка документации, меньше = выше)
 *   tag: Release               (метка)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "static", "content.json");

marked.setOptions({ gfm: true, breaks: false });

/** Разобрать простой front-matter `key: value` (без жёсткой зависимости от YAML). */
function parseFrontMatter(raw) {
  const meta = {};
  let body = raw;
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    body = raw.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/);
      if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, "");
    }
  }
  return { meta, body };
}

function slug(fileName) {
  return fileName.replace(/\.md$/i, "");
}

function collect(dirName, defaultTag) {
  const dir = path.join(ROOT, dirName);
  const items = [];
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => /\.md$/i.test(f));
  } catch {
    return items; // папки нет — пустой раздел, это нормально
  }
  for (const f of files) {
    const full = path.join(dir, f);
    const raw = readFileSync(full, "utf8");
    const { meta, body } = parseFrontMatter(raw);
    const id = slug(f);
    const title = meta.title || id;
    let date = meta.date || null;
    if (date && isNaN(Date.parse(date))) date = null;
    if (!date) date = new Date(statSync(full).mtime).toISOString().slice(0, 10);
    const order = Number.parseInt(meta.order ?? "0", 10) || 0;
    items.push({
      id,
      title,
      date,
      order,
      tag: meta.tag || defaultTag,
      markdown: body.trim(),
      html: marked.parse(body.trim()),
    });
  }
  return items;
}

const docs = collect("docs", "Docs").sort(
  (a, b) => a.order - b.order || a.id.localeCompare(b.id),
);
const news = collect("news", "News").sort(
  (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
);

writeFileSync(OUT, JSON.stringify({ docs, news }, null, 2), "utf8");
console.log(`content.json: ${docs.length} документов (docs/), ${news.length} новостей (news/)`);
