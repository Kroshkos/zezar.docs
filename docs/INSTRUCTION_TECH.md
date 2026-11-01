---
title: Инструкция — Технические специалисты (пошаговая)
order: 60
date: 2026-11-01
tag: Guide
---

# Инструкция для технических специалистов (dev / devops / support)

Пошаговое руководство по сборке, запуску, миграциям, тестированию и диагностике
веб-сервиса «ЦЕЗАРЬ». Предполагается, что пользователь умеет работать в терминале;
каждая команда дана готовой к копированию. Пользовательские роли описаны в других
инструкциях — здесь только «под капотом».

**Стек:** Python 3.12 + FastAPI (async) + SQLAlchemy 2.x async + SQLite (aiosqlite),
Jinja2 SSR + Vanilla JS, фоновые воркеры в процессе приложения, Docker.

---

## 0. Карта инструкции

| Раздел | Тема |
|---|---|
| 1 | Архитектура и структура кода |
| 2 | Модель данных (сущности, payload, справочники, шеринг) |
| 3 | RBAC: роли, инварианты, кэш прав acl_epoch |
| 4 | Аутентификация: логин+пароль, сессии, env-админ, троттлинг |
| 5 | Локальный запуск (разработка) по шагам |
| 6 | Запуск в Docker / docker-compose по шагам |
| 7 | Переменные окружения и fail-fast правила |
| 8 | Миграции Alembic и self-healing схемы |
| 9 | Тесты (e2e) |
| 10 | Интеграции: Telegram, Яндекс Календарь, outbox-воркеры |
| 11 | Бэкап / восстановление / обновление |
| 12 | Ограничение «один экземпляр» и план роста |
| 13 | Диагностика: симптом → где искать → чиним |
| 14 | Логирование и доступ к данным |

---

## 1. Архитектура и структура кода

```
app/                    # ядро (ничего не знает о содержимом модулей)
  core/                 # config (fail-fast), security (пароли/сессии), access (RBAC),
                        # entity_service, refdata (справочники двухуровневые),
                        # module_registry, permcache (acl_epoch), events (аудит),
                        # notify, meet_groups
  models/               # core.py (User/Department/Entity/Role…), module_payloads.py
  routers/              # auth, pages, admin, departments, sharing, refdata, notify, profile
  templates/            # login, base, admin_users, admin_events, integrations, change_password
modules/                # плагины: dashboard tasks projects meetings admin_dept
                        # docs softs grants schols priority
integrations/           # yandex_calendar (WebDAV), telegram_service, tg_queries, workers
db/, alembic/           # движок БД, сиды, миграции
scripts/                # e2e_test.py
static/                 # CSS/JS из прототипа
Dockerfile, docker-compose.yml, requirements.txt, .env.example
```

Принцип плагинов: новый модуль = пакет `modules/<name>/manifest.py`, вызывающий
`registry.register(ModuleSpec(...))` (название, иконка, порядок, REST-роутер,
HTML-страницы, payload-модель, календарный маппер). Ядро не правится. Реестр
синхронизируется с таблицей `module_registry` (UI администрирования); включение
модуля пространству — строка `workspace_modules.is_enabled`.

<!-- 📷 СЮДА НУЖНО ВСТАВИТЬ КАРТИНКУ (architecture).
     Что должно быть на скриншоте: схема архитектуры: ядро, модули, интеграции, воркеры (можно нарисовать от руки или в draw.io).
     Когда вставите картинку — замените весь этот блок одной строкой:
     ![подпись](static/img/ВАШ_ФАЙЛ.png)  -->

*(📷 Здесь будет картинка: «Схема архитектуры: ядро, модули, интеграции, воркеры». Файл для вставки: IMAGE_PLACEHOLDER_architecture.png)*


---

## 2. Модель данных

* **`Entity`** — полиморфный реестр карточек всех модулей: `kind` + общие поля
  (title/status/priority/due/tags) + `payload_id` → специфика в `*_payload`
  таблицах модулей (1:1). Единые механизмы шеринга, ответственных, аудита и
  интеграций работают для любого модуля без правок ядра.
* Собственник карточки — **подразделение** (изоляция пространств на уровне сервиса).
* **`EntityShare`** — шеринг другому подразделению (`READ | EDIT | FULL`).
* **`EntityResponsible`** — инвариант: **по одному ответственному от каждого
  участвующего подразделения**; обеспечивается сервисным слоем (пустой слот
  подсвечивается в UI).
* **Иерархия задач**: у задачи есть родитель (самостоятельная = NULL). Циклы
  запрещены серверной проверкой предков; печатная карточка формируется только
  для root-задач, подзадачи выводятся строками
  `наименование · дедлайн · статус` внутри родителя (многоуровнево, «↳»).
* **Справочники двухуровневые**: глобальные шаблоны (`department_id IS NULL`) и
  активированные копии пространств; колонка `source_global_id` даёт
  преемственность при deactivate/activate. Удаление записи, используемой живыми
  карточками, запрещено на уровне сервиса.
* **`AuditLog` + `OutboxEvent`** — транзакционная очередь фоновых задач
  (transactional outbox: событие и данные меняются в одной транзакции).

---

## 3. RBAC: модель прав и кэш acl_epoch

Вся логика прав — в `app/core/access.py`; инвалидация сессий — `permcache.py`.

* Глобальная роль: `users.role` = ADMIN / COORDINATOR / HEAD / MEMBER.
  Роль в пространстве: `department_members.role_in_dept` = HEAD / MEMBER.
* **`set_department_role` — единственная точка изменения `role_in_dept`:**
  * инвариант «≥1 HEAD в пространстве»: нарушение → HTTP 409 с текстом
    («в подразделении должен остаться хотя бы один руководитель») — текст
    обязан показываться в UI;
  * синхронизация глобальной роли (HEAD ↔ users.role);
  * повышение до HEAD доступно только глобальным акторам
    (`allow_head_promotion=ctx.is_global`).
* Каждая мутация состава/ролей вызывает `bump_epoch` + **перевыпуск cookie**;
  ответ `add_member` ставит свежую session-cookie с актуальным epoch
  принудительно (`force=True`, минуя process-local TTL-mirror ~5 c) — иначе при
  нескольких процессах страница рендерилась по устаревшей эпохе.
* **Проверка пространства при создании карточек** (`_pick_department` во всех
  модулях) — порядок обязательный:
  1. если выбранное пространство ∈ списку пространств пользователя (membership) —
     доступ разрешён независимо от глобальной роли;
  2. явный выбор чужого пространства — только ADMIN/COORDINATOR, иначе
     403 «выбор чужого пространства…».
  Исторический баг: раньше membership не проверялся первым → HEAD получал 403 в
  собственном пространстве. Новые модули обязаны наследовать исправленную логику
  (общий хелпер, не копируйте старую проверку).
* Значения ролей в шаблонах/API — enum (`admin`, `coordinator`, `head`, `member`);
  нормализация входа — `_norm_role` в pydantic-моделях.

---

## 4. Аутентификация (актуальный контур)

**Только логин + пароль.** OAuth/Яндекс ID удалены из кода; легаси-колонки
(`users.yandex_id`, таблица `invites`) пережитками не используются и вычищаются
self-healing-логикой старта/миграций — обратных зависимостей не добавляйте.

* `POST /auth/login` — проверка хеша (bcrypt-style), троттлинг: 10 фейлов/IP за
  15 минут → `/login?error=too_many`; события `login_failed`/`login_throttle` в аудит.
* `must_change_password` → редирект на «Смену пароля» (и после сброса админом).
* Сессия — подписанный HMAC-SHA256 токен в cookie `HttpOnly / SameSite=Lax`,
  14 дней, поле `acl_epoch`; флаг `Secure` — в production или `COOKIE_SECURE=true`.
* Env-админ: `ADMIN_USERNAME`/`ADMIN_PASSWORD` (или `ADMIN_LOGINS=u:p,u2:p2`);
  сид `sync_admin_logins` при каждом старте создаёт/чинит учётку и гарантирует
  роль ADMIN.
* `POST /auth/logout`, `GET /auth/me`. Dev-логин (`/auth/dev-login`) существует
  только при `DEV_LOGIN_ENABLED=true` и заблокирован fail-fast в production.
* App-пароли Яндекса в БД — только Fernet-шифротекст.

---

## 5. Локальный запуск (разработка) — по шагам

```bash
git clone https://github.com/Kroshkos/Zezar && cd Zezar
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # отредактируйте: SECRET_KEY, ADMIN_USERNAME/PASSWORD
mkdir -p data
export DATABASE_PATH=./data/caesar.db
uvicorn app.main:app --reload
```

Открыть: <http://localhost:8000>. В development доступны dev-вход и демо-сид
(только при `SEED_DEMO_DATA=true`). Схема создаётся идемпотентно (`create_all` +
bootstrap-сид).

<!-- 📷 СЮДА НУЖНО ВСТАВИТЬ КАРТИНКУ (dev_run).
     Что должно быть на скриншоте: терминал: uvicorn поднялся (строка Uvicorn running...) и открытая страница входа.
     Когда вставите картинку — замените весь этот блок одной строкой:
     ![подпись](static/img/ВАШ_ФАЙЛ.png)  -->

*(📷 Здесь будет картинка: «Локальный запуск: uvicorn поднялся, открыта страница входа». Файл для вставки: IMAGE_PLACEHOLDER_dev_run.png)*


---

## 6. Запуск в Docker (production-like) — по шагам

```bash
cp .env.example .env   # заполнить ОБЯЗАТЕЛЬНЫЕ переменные окружения (раздел 7)
docker compose up -d --build
curl -s http://localhost:8000/healthz   # ожидаем {"ok":true,"modules":[...]}
```

Проверки после старта:

1. healthz вернул `ok:true` и список модулей;
2. вход под env-админом работает;
3. `docker compose logs -f caesar` чистый (категории `caesar.auth`, интеграции);
4. контейнер non-root, volume `caesar-data` примонтирован в `/data`.

Reverse-proxy с TLS (nginx/traefik/Caddy) **обязателен**: приложение слушает
HTTP :8000; uvicorn запускается с `--proxy-headers`, чтобы cookie получала флаг
Secure из `X-Forwarded-Proto`.

---

## 7. Переменные окружения и fail-fast

Обязательные: `SECRET_KEY` (случайный, ≥32 символов), `ADMIN_USERNAME`,
`ADMIN_PASSWORD`, `DATABASE_PATH=/data/caesar.db`, `DATA_DIR=/data`.
Опциональные: `TELEGRAM_BOT_TOKEN`, `YANDEX_CAL_*`, `SYNC_INTERVAL_SECONDS`
(по умолчанию 300), `COOKIE_SECURE`, `PUBLIC_BASE_URL`, `ENVIRONMENT`,
`DEV_LOGIN_ENABLED`, `SEED_DEMO_DATA`.

**Fail-fast:** при `ENVIRONMENT=production` сервис **не стартует**, если
`SECRET_KEY` = `change-me` или короче 32 символов; включён dev-вход или демо-сид;
не заданы `ADMIN_USERNAME`/`ADMIN_PASSWORD`. Контейнер падает на старте с явной
строкой в логах — это штатная защита, а не поломка.

Аутрич-трафик, необходимый сервису: `api.telegram.org`, `webdav.yandex.ru`
(OAuth-домены больше не нужны).

---

## 8. Миграции Alembic и self-healing схемы

* Схема управляется **Alembic**; базовая ревизия `alembic/versions/*baseline*`
  создаёт ядро + payload-таблицы модулей.
* Entrypoint контейнера определяет состояние `/data`:
  * новая БД → `alembic upgrade head`;
  * легаси-БД без таблицы `alembic_version` → `stamp baseline` + `upgrade head`
    (данные не трогаются).
* Приложение при старте дополнительно досоздаёт отсутствующие колонки
  (`ALTER TABLE ADD COLUMN`) — защита от ложного `stamp head`.
* Добавить колонку/таблицу по шагам:
  1. правьте модель;
  2. `alembic revision --autogenerate -m "описание"`;
  3. **проверьте** сгенерированную ревизию (SQLite — batch-режим: пересоздание
     таблиц, следите за индексами и ограничениями);
  4. коммитьте ревизию вместе с моделью;
  5. на стенде: `alembic upgrade head` + прогон тестов.
* Удаление легаси-колонок OAuth/invites выполняет self-healing-логика старта —
  не добавляйте код, который их читает.

---

## 9. Тесты

```bash
PYTHONPATH=. python scripts/e2e_test.py     # 16 сквозных сценариев
pytest                                       # юнит/интеграционные, включая RBAC-кейсы
```

E2E покрывает: вход по логину/паролю, RBAC, CRUD модулей, outbox-воркер, шеринг и
изоляцию пространств, инвариант ответственных, ICS/время совещаний.
RBAC-кейсы обязательны при трогании `_pick_department`/`set_department_role`:
создание карточки HEAD в своём пространстве с явным `department_id`; мгновенная
смена роли; 409 при понижении последнего HEAD.

---

## 10. Интеграции и фоновые процессы

**Telegram** (`integrations/telegram_service.py`): long-polling-воркер внутри
приложения. Привязка: бот запрашивает логин → пароль (без кодов), сообщения
привязки удаляются из чата, неизвестный логин молча игнорируется (анти-разведка).
Команды `/mute`, `/unmute`, `/help`. Без `TELEGRAM_BOT_TOKEN` уведомления просто
не отправляются. Отправка — через outbox (события не теряются при простое).

**Яндекс Календарь** (`integrations/yandex_calendar.py`): WebDAV/CalDAV
`webdav.yandex.ru`, Basic-auth (логин Яндекса + пароль приложения, Fernet в БД).
Diff-проход каждые `SYNC_INTERVAL_SECONDS` переводит PENDING → SYNCED; UID
детерминирован (идемпотентность). Состояния `SyncState`; ошибки 401/403 пишутся
в статус конкретного пользователя, **не блокируя остальных**. Старый адрес
`dav.yandex.ru` не поддерживать. Область синхронизации: Member — свои,
Head — подразделение, Coordinator/Admin — система.

**Уведомления-сценарии** (`app/routers/notify.py`): базовые (неотключаемые) +
пользовательские (событие → audience → шаблон); broadcast с планированием/
отменой и предпросмотром получателей.

Все воркеры (notifier, outbox, tg_poller, calendar diff) живут в lifespan
приложения → см. ограничение раздела 12.

---

## 11. Бэкап, восстановление, обновление

Бэкап (ежедневно, рекомендовано cron):

```bash
sqlite3 /data/caesar.db "VACUUM INTO '/backup/caesar-$(date +%F).db'"
```

Восстановление по шагам:

1. остановить сервис (`docker compose down`);
2. заменить `caesar.db` на снапшот;
3. удалить `-wal`/`-shm` файлы рядом;
4. запустить (`docker compose up -d`); миграции применятся автоматически.

Обновление версии:

```bash
git pull && docker compose up -d --build
```

Данные живут **только** в volume `caesar-data` (`/data`). Всё остальное — эфемерно.

---

## 12. Ограничение «один экземпляр» и план роста

SQLite + in-process воркеры + process-local кэш прав рассчитаны ровно на **один
процесс**:

* две копии с общей БД → `database is locked`, двойной поллинг Telegram,
  рассинхрон `acl_epoch` («роль сменили, UI старый»);
* контролируйте масштабирование хостинга (Amvera/orchestrator) — реплик быть не должно;
* план роста >~50 активных пользователей: PostgreSQL + внешний воркер
  (SessionLocal изолирован от web-процесса).

---

## 13. Диагностика: симптом → где искать → чиним

| Симптом | Где искать | Как чинить |
|---|---|---|
| 403 при создании карточки в своём пространстве | membership-часть `_pick_department`; строка в `department_members`; аудит `login`/`add_member` | Восстановить членство; если логика модуля не наследует исправленный порядок проверок — патчить модуль на общий хелпер |
| Роль применилась, но UI старый | `acl_epoch` в cookie vs БД; число процессов сервиса; force-перевыпуск cookie в мутациях | Один экземпляр; перезапуск; проверить, что мутация идёт через `set_department_role` |
| Не понижается последний HEAD | Штатный 409 из `set_department_role` | Это не баг. Текст ошибки должен показываться в UI — если «молчит», чинить отображение 409 |
| Контейнер не стартует | Логи fail-fast (SECRET_KEY / ADMIN_* / DEV-флаги) | Дозадать env по разделу 7 |
| `database is locked` | Два процесса на одном `/data` | Убить лишние; оставить один экземпляр |
| Нет уведомлений Telegram | Статус токена/воркера, `telegram_chat_id` пользователя, optout (`/mute`), таблица outbox | Перепривязать пользователя; проверить `TELEGRAM_BOT_TOKEN`; смотреть логи poller'а |
| Календарь не обновляется | Привязка app-пароля, `SyncState` (PENDING/cal_error), период SYNC_INTERVAL | 401/403 — пользователь перевводит пароль приложения; проверить доступ к `webdav.yandex.ru` |
| Cookie слетает | HTTPS / проброс `X-Forwarded-Proto`, `COOKIE_SECURE` | Настроить proxy (`proxy_set_header X-Forwarded-Proto $scheme;`), включить Secure |
| Печать карточек «теряет» подзадачи | Формирование печатной карточки root-задачи: блок подзадач `наименование · дедлайн · статус` | Проверить, что задача реально подзадача (родитель жив); удалённый родитель возвращает обычную печать — штатно |

---

## 14. Логи и доступ к данным

* Журнал событий UI: `/admin/events` (фильтры по категории/поиску) + таблица `events` в БД.
* Логи приложения: `docker compose logs -f caesar` (категории `caesar.auth`,
  интеграции, воркеры).
* Прямой осмотр БД (только read-only!): `sqlite3 /data/caesar.db ".tables"`,
  затем SELECT-запросы. Не выполняйте UPDATE/DELETE руками — нарушите инварианты
  (ответственные, acl_epoch, outbox).

По продуктовым вопросам ролей смотрите инструкции: Участник / Руководитель /
Координатор / Администратор; по развёртыванию — `DEPLOY.md`.
