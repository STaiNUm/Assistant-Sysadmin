// ===== Хранилище: роутер и экраны =====

import * as DB from './db.js';
import { el, modal, confirmModal, promptModal, toast, plural } from './ui.js';

const FIELD_TYPES = {
  text: 'Текст',
  textarea: 'Текст (многострочный)',
  number: 'Число',
  checkbox: 'Галочка',
  select: 'Список',
  date: 'Дата',
};

const FOLDER_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
];

const SORT_LABELS = {
  title: 'По названию',
  new: 'Сначала новые',
  old: 'Сначала старые',
};

// ===== Мелкие помощники =====

function vibrate(ms = 10) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
}

function getSortMode() {
  try { return localStorage.getItem('sortMode') || 'title'; } catch (e) { return 'title'; }
}

function setSortMode(value) {
  try { localStorage.setItem('sortMode', value); } catch (e) {}
}

function getShowDone() {
  try { return localStorage.getItem('tasksShowDone') === '1'; } catch (e) { return false; }
}

function setShowDone(value) {
  try { localStorage.setItem('tasksShowDone', value ? '1' : '0'); } catch (e) {}
}

// Дата последнего экспорта — в localStorage, чтобы база оставалась совместимой с основной версией
function getLastExport() {
  try { return Number(localStorage.getItem('lastExportAt') || 0) || null; } catch (e) { return null; }
}

function setLastExport(ts) {
  try { localStorage.setItem('lastExportAt', String(ts)); } catch (e) {}
}

// ===== Общие компоненты =====

function header({ title, color = null, back = null, actions = [] }) {
  return el('header', { class: 'header' },
    back
      ? el('a', { class: 'header-btn', href: back, 'aria-label': 'Назад' }, '←')
      : el('span', { class: 'header-btn placeholder' }),
    el('h1', { class: 'header-title' },
      color
        ? el('span', { class: 'header-dot', style: `--folder-color:${color}` })
        : null,
      title
    ),
    actions.length
      ? el('div', { class: 'header-actions' },
          actions.map((a) =>
            el('a', { class: 'header-btn', href: a.href, 'aria-label': a.label, title: a.label }, a.icon)
          )
        )
      : el('span', { class: 'header-btn placeholder' })
  );
}

function fab(href, label, extra = '') {
  return el('a', { class: 'fab' + (extra ? ' ' + extra : ''), href, 'aria-label': label, title: label }, '＋');
}

function fabAction(onClick, label, extra = '') {
  return el('button', { class: 'fab' + (extra ? ' ' + extra : ''), type: 'button', 'aria-label': label, title: label, onClick }, '＋');
}

// Нижняя панель: необязательный блок ввода сверху + вкладки
function bottombar(active, composer = null) {
  const tab = (href, icon, label, key, withBadge) =>
    el('a', { class: 'tab' + (active === key ? ' active' : ''), href },
      el('span', { class: 'tab-icon-wrap' },
        el('span', { class: 'tab-icon' }, icon),
        withBadge ? el('span', { class: 'tab-badge', style: 'display:none' }) : null
      ),
      el('span', { class: 'tab-label' }, label)
    );
  return el('div', { class: 'bottombar' },
    composer,
    el('nav', { class: 'tabbar' },
      tab('#/', '🗂️', 'Хранилища', 'storages', false),
      tab('#/tasks', '☑️', 'Задачи', 'tasks', true)
    )
  );
}

// Счётчик активных задач на вкладке «Задачи»
async function updateTasksBadge(root) {
  try {
    const tasks = await DB.getAll('tasks');
    const n = tasks.filter((t) => !t.done).length;
    const badge = root.querySelector('.tab[href="#/tasks"] .tab-badge');
    if (badge) {
      badge.textContent = String(n);
      badge.style.display = n ? '' : 'none';
    }
  } catch (e) {}
}

function getTitleField(folder) {
  return (
    folder.fields.find((f) => f.isTitle && f.type === 'text') ||
    folder.fields.find((f) => f.type === 'text') ||
    null
  );
}

// Ссылка на контейнер внутри хранилища: само хранилище или папка (по пути из id)
function containerUrl(folderId, pathIds = []) {
  return `#/folder/${folderId}` + (pathIds.length ? '/' + pathIds.join('/') : '');
}

// Путь (массив id) от корня хранилища до указанной папки
function pathIdsFor(groups, groupId) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const ids = [];
  let cur = byId.get(groupId);
  while (cur) {
    ids.unshift(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return ids;
}

// Подпись вида «2 папки · 5 записей»
function summary(groupCount, recordCount) {
  const parts = [];
  if (groupCount) parts.push(plural(groupCount, 'папка', 'папки', 'папок'));
  parts.push(plural(recordCount, 'запись', 'записи', 'записей'));
  return parts.join(' · ');
}

// ===== Экран: главная (список хранилищ) =====

async function renderHome(root) {
  const [folders, records, groups, tasks] = await Promise.all([
    DB.getAll('folders'), DB.getAll('records'), DB.getAll('groups'), DB.getAll('tasks'),
  ]);
  const counts = {};
  records.forEach((r) => { counts[r.folderId] = (counts[r.folderId] || 0) + 1; });
  const groupCounts = {};
  groups.forEach((g) => { groupCounts[g.folderId] = (groupCounts[g.folderId] || 0) + 1; });
  folders.sort((a, b) => a.createdAt - b.createdAt);
  const byId = new Map(folders.map((f) => [f.id, f]));

  root.append(
    header({
      title: 'Хранилища',
      actions: [{ icon: '⚙', href: '#/settings', label: 'Настройки' }],
    })
  );

  const main = el('main', { class: 'content tabbed' });

  // Напоминание о резервной копии
  const lastExport = getLastExport();
  let dismissedAt = 0;
  try { dismissedAt = Number(localStorage.getItem('backupNoticeDismissedAt') || 0); } catch (e) {}
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const hasData = folders.length || records.length || tasks.length;
  if (hasData && (!lastExport || Date.now() - lastExport > WEEK) && Date.now() - dismissedAt > WEEK) {
    const notice = el('div', { class: 'notice' },
      el('span', { class: 'notice-text' }, 'Давно не делали копию. Экспорт — в настройках.'),
      el('button', {
        type: 'button', class: 'notice-x', 'aria-label': 'Скрыть',
        onClick: () => {
          try { localStorage.setItem('backupNoticeDismissedAt', String(Date.now())); } catch (e) {}
          notice.remove();
        },
      }, '✕')
    );
    main.append(notice);
  }

  // Поиск сразу по всем хранилищам
  let query = '';
  const searchInput = el('input', {
    class: 'search-input',
    type: 'search',
    placeholder: 'Поиск по всем хранилищам…',
    onInput: (e) => { query = e.target.value; renderBody(); },
  });
  main.append(el('div', { class: 'controls' }, searchInput));

  const body = el('div');
  main.append(body);

  function renderBody() {
    const q = query.trim().toLowerCase();
    body.innerHTML = '';

    if (!q) {
      if (!folders.length) {
        body.append(
          el('div', { class: 'empty' },
            el('div', { class: 'empty-icon' }, '🗂️'),
            el('p', {}, 'Хранилищ пока нет.'),
            el('p', {}, 'Нажмите ＋, чтобы создать первое.')
          )
        );
      } else {
        body.append(
          el('div', { class: 'folder-list' },
            folders.map((f) =>
              el('a', {
                class: 'folder-card',
                href: `#/folder/${f.id}`,
                style: `--folder-color:${f.color}`,
              },
                el('span', { class: 'folder-color' }),
                el('span', { class: 'folder-name' }, f.name),
                el('span', { class: 'folder-count' },
                  summary(groupCounts[f.id] || 0, counts[f.id] || 0))
              )
            )
          )
        );
      }
      return;
    }

    const found = [];
    records.forEach((r) => {
      const folder = byId.get(r.folderId);
      if (!folder) return;
      const text =
        folder.fields.map((f) => String(r.values[f.id] ?? '')).join(' ') +
        ' ' + (r.note || '');
      if (!text.toLowerCase().includes(q)) return;
      const titleField = getTitleField(folder);
      found.push({
        record: r,
        folder,
        title: String(r.values[titleField?.id] ?? '').trim() || 'Без названия',
      });
    });

    if (!found.length) {
      body.append(el('div', { class: 'empty' }, el('p', {}, 'Ничего не найдено.')));
      return;
    }

    found.sort((a, b) => a.title.localeCompare(b.title, 'ru', { numeric: true }));
    body.append(
      el('div', { class: 'record-list' },
        found.map(({ record, folder, title }) => {
          const ids = record.groupId ? pathIdsFor(groups, record.groupId) : [];
          const names = ids
            .map((id) => (groups.find((g) => g.id === id) || {}).name)
            .filter(Boolean);
          return el('a', {
            class: 'record-row',
            href: `#/record/${record.id}`,
            style: `--folder-color:${folder.color}`,
          },
            el('span', { class: 'record-dot' }),
            el('span', { class: 'record-main' },
              el('span', { class: 'record-title' }, title),
              el('span', { class: 'record-sub' }, [folder.name, ...names].join(' / '))
            ),
            el('span', { class: 'record-chevron' }, '›')
          );
        })
      )
    );
  }

  renderBody();
  root.append(main, fab('#/new-folder', 'Создать хранилище', 'fab-tabs'), bottombar('storages'));
  updateTasksBadge(root);
}

// ===== Экран: задачи =====

async function renderTasks(root) {
  const tasks = await DB.getAll('tasks');

  root.append(header({ title: 'Задачи' }));

  const main = el('main', { class: 'content tabbed' });
  const listContainer = el('div');
  main.append(listContainer);

  // Поле ввода — внизу, над вкладками (удобно дотягиваться большим пальцем)
  const input = el('input', { class: 'input', type: 'text', placeholder: 'Новая задача…' });
  const add = async () => {
    const text = input.value.trim();
    if (!text) return;
    const task = { id: DB.uid(), text, done: false, createdAt: Date.now(), completedAt: null };
    await DB.put('tasks', task);
    tasks.push(task);
    input.value = '';
    input.focus();
    refresh();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  const composer = el('div', { class: 'task-composer' },
    input,
    el('button', { type: 'button', class: 'btn btn-primary', onClick: add, 'aria-label': 'Добавить задачу' }, '＋')
  );

  function refresh() {
    const active = tasks.filter((t) => !t.done).sort((a, b) => b.createdAt - a.createdAt);
    const done = tasks
      .filter((t) => t.done)
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

    const makeRow = (t, isDone) =>
      el('div', { class: 'task-row' + (isDone ? ' done' : '') },
        el('button', {
          type: 'button',
          class: 'task-check' + (isDone ? ' checked' : ''),
          'aria-label': isDone ? 'Снять отметку' : 'Отметить выполненной',
          onClick: async () => {
            t.done = !t.done;
            t.completedAt = t.done ? Date.now() : null;
            await DB.put('tasks', t);
            vibrate(10);
            refresh();
          },
        }, isDone ? '✓' : ''),
        el('button', {
          type: 'button',
          class: 'task-text',
          onClick: async () => {
            const nv = await promptModal({ title: 'Изменить задачу', value: t.text });
            if (nv) { t.text = nv; await DB.put('tasks', t); refresh(); }
          },
        }, t.text),
        el('button', {
          type: 'button',
          class: 'icon-btn danger',
          'aria-label': 'Удалить задачу',
          onClick: async () => {
            await DB.del('tasks', t.id);
            const i = tasks.findIndex((x) => x.id === t.id);
            if (i >= 0) tasks.splice(i, 1);
            toast('Задача удалена');
            refresh();
          },
        }, '✕')
      );

    const list = (arr, isDone) =>
      el('div', { class: 'task-list' }, arr.map((t) => makeRow(t, isDone)));

    listContainer.innerHTML = '';

    if (!tasks.length) {
      listContainer.append(
        el('div', { class: 'empty' },
          el('div', { class: 'empty-icon' }, '☑️'),
          el('p', {}, 'Задач пока нет.'),
          el('p', {}, 'Впишите первую в поле снизу и нажмите ＋.')
        )
      );
      return;
    }

    listContainer.append(
      el('p', { class: 'muted task-summary' }, `Выполнено ${done.length} из ${tasks.length}`)
    );
    if (active.length) {
      listContainer.append(el('div', { class: 'section-title' }, 'Активные'), list(active, false));
    }
    if (done.length) {
      const showDone = getShowDone();
      listContainer.append(
        el('button', {
          type: 'button',
          class: 'section-title section-toggle',
          onClick: () => { setShowDone(!showDone); refresh(); },
        },
          `Выполненные (${done.length})`,
          el('span', { class: 'section-toggle-chevron' }, showDone ? '▾' : '▸')
        )
      );
      if (showDone) {
        listContainer.append(
          list(done, true),
          el('button', {
            type: 'button',
            class: 'btn btn-small clear-done',
            onClick: async () => {
              const ok = await confirmModal({
                title: 'Очистить выполненные?',
                text: `Будет удалено ${plural(done.length, 'задача', 'задачи', 'задач')}.`,
                okText: 'Очистить',
                danger: true,
              });
              if (!ok) return;
              const ids = new Set(done.map((t) => t.id));
              for (const t of done) await DB.del('tasks', t.id);
              for (let i = tasks.length - 1; i >= 0; i--) {
                if (ids.has(tasks[i].id)) tasks.splice(i, 1);
              }
              toast('Выполненные очищены');
              refresh();
            },
          }, 'Очистить выполненные')
        );
      }
    }

    updateTasksBadge(root);
  }

  refresh();
  root.append(main, bottombar('tasks', composer));
}

// ===== Экран: хранилище или папка (список папок и записей) =====

async function renderFolder(root, folderId, groupPath = []) {
  const folder = await DB.get('folders', folderId);
  if (!folder) { location.hash = '#/'; return; }

  const groups = await DB.groupsByFolder(folderId);
  const allRecords = await DB.recordsByFolder(folderId);

  // Восстанавливаем путь и проверяем, что он корректен
  const path = [];
  let parentId = null;
  for (const gid of groupPath) {
    const g = groups.find((x) => x.id === gid && x.parentId === parentId);
    if (!g) { location.hash = containerUrl(folderId); return; }
    path.push(g);
    parentId = g.id;
  }
  const current = path.length ? path[path.length - 1] : null;
  const currentId = current ? current.id : null;
  const pathIds = path.map((g) => g.id);

  const childGroups = groups
    .filter((g) => g.parentId === currentId)
    .sort((a, b) => a.createdAt - b.createdAt);
  const records = allRecords.filter((r) => (r.groupId || null) === currentId);

  const childrenOf = (pid) => groups.filter((g) => g.parentId === pid);
  const directRecords = (gid) => allRecords.filter((r) => (r.groupId || null) === gid).length;
  const subtreeRecords = (gid) =>
    directRecords(gid) + childrenOf(gid).reduce((s, c) => s + subtreeRecords(c.id), 0);

  let search = '';
  let filterValue = '';
  let sortMode = getSortMode();
  const selectField = folder.fields.find((f) => f.type === 'select');

  root.append(
    header({
      title: current ? current.name : folder.name,
      color: folder.color,
      back: current ? containerUrl(folderId, pathIds.slice(0, -1)) : '#/',
      actions: current
        ? [{ icon: '✎', href: `#/edit-group/${current.id}`, label: 'Изменить папку' }]
        : [{ icon: '✎', href: `#/folder/${folderId}/edit`, label: 'Изменить хранилище' }],
    })
  );

  const main = el('main', { class: 'content' });

  // Хлебные крошки
  const crumbs = el('div', { class: 'breadcrumbs' });
  const addCrumb = (label, href, isCurrent) => {
    if (crumbs.childNodes.length) crumbs.append(el('span', { class: 'crumb-sep' }, '/'));
    crumbs.append(
      href && !isCurrent
        ? el('a', { class: 'crumb', href }, label)
        : el('span', { class: 'crumb current' }, label)
    );
  };
  addCrumb(folder.name, containerUrl(folderId), !current);
  path.forEach((g, i) => {
    addCrumb(g.name, containerUrl(folderId, pathIds.slice(0, i + 1)), i === path.length - 1);
  });
  main.append(crumbs);

  // Поиск и фильтр (по записям текущего контейнера)
  const searchInput = el('input', {
    class: 'search-input',
    type: 'search',
    placeholder: 'Поиск…',
    onInput: (e) => { search = e.target.value; renderList(); },
  });
  const controls = el('div', { class: 'controls' }, searchInput);

  if (selectField) {
    const list = await DB.get('lists', selectField.listId);
    const options = list ? list.options : [];
    controls.append(
      el('select', {
        class: 'filter-select',
        onChange: (e) => { filterValue = e.target.value; renderList(); },
      },
        el('option', { value: '' }, `${selectField.name}: все`),
        options.map((o) => el('option', { value: o }, o))
      )
    );
  }

  // Сортировка записей
  controls.append(
    el('select', {
      class: 'filter-select',
      onChange: (e) => { sortMode = e.target.value; setSortMode(sortMode); renderList(); },
    },
      Object.entries(SORT_LABELS).map(([value, label]) =>
        el('option', { value, selected: sortMode === value }, label))
    )
  );

  main.append(controls);

  const listEl = el('div', { class: 'record-list' });
  main.append(listEl);

  const titleField = getTitleField(folder);
  const recordText = (r) =>
    folder.fields.map((f) => String(r.values[f.id] ?? '')).join(' ') + ' ' + (r.note || '');

  function renderList() {
    const q = search.trim().toLowerCase();
    const rows = records.filter((r) => {
      if (filterValue && String(r.values[selectField.id] ?? '') !== filterValue) return false;
      if (q && !recordText(r).toLowerCase().includes(q)) return false;
      return true;
    });
    if (sortMode === 'new') {
      rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else if (sortMode === 'old') {
      rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    } else {
      rows.sort((a, b) =>
        String(a.values[titleField?.id] ?? '').localeCompare(
          String(b.values[titleField?.id] ?? ''), 'ru', { numeric: true })
      );
    }

    listEl.innerHTML = '';

    // Папки
    if (childGroups.length) {
      listEl.append(el('div', { class: 'section-title' }, 'Папки'));
      childGroups.forEach((g) => {
        const gc = childrenOf(g.id).length;
        const rc = subtreeRecords(g.id);
        listEl.append(
          el('a', {
            class: 'group-row',
            href: containerUrl(folderId, [...pathIds, g.id]),
            style: `--folder-color:${folder.color}`,
          },
            el('span', { class: 'group-icon' }, '📁'),
            el('span', { class: 'group-main' },
              el('span', { class: 'group-name' }, g.name),
              el('span', { class: 'group-sub' }, gc || rc ? summary(gc, rc) : 'пусто')
            ),
            el('span', { class: 'group-chevron' }, '›')
          )
        );
      });
    }

    // Записи
    if (rows.length) {
      if (childGroups.length) listEl.append(el('div', { class: 'section-title' }, 'Записи'));
      rows.forEach((r, i) => {
        const title = String(r.values[titleField?.id] ?? '').trim() || 'Без названия';
        const loc = selectField ? String(r.values[selectField.id] ?? '') : '';
        listEl.append(
          el('a', {
            class: 'record-row',
            href: `#/record/${r.id}`,
            style: `--folder-color:${folder.color}`,
          },
            el('span', { class: 'record-num' }, String(i + 1)),
            el('span', { class: 'record-main' },
              el('span', { class: 'record-title' }, title),
              loc ? el('span', { class: 'record-sub' }, loc) : null
            ),
            el('span', { class: 'record-chevron' }, '›')
          )
        );
      });
    }

    if (!childGroups.length && rows.length === 0) {
      listEl.append(
        el('div', { class: 'empty' },
          el('p', {}, records.length === 0 ? 'Здесь пока пусто.' : 'Ничего не найдено.'),
          records.length === 0
            ? el('p', {}, 'Нажмите ＋, чтобы создать папку или запись.')
            : null
        )
      );
    }
  }

  renderList();
  root.append(main, fabAction(() => openCreateMenu(folderId, pathIds), 'Создать'));
}

// Меню создания: папка или запись
function openCreateMenu(folderId, pathIds = []) {
  const suffix = pathIds.length ? '/' + pathIds.join('/') : '';
  const go = (hash) => { m.close(); location.hash = hash; };
  const m = modal({
    title: 'Что создать?',
    content: [
      el('button', {
        type: 'button',
        class: 'btn btn-block create-choice',
        onClick: () => go(`#/new-group/${folderId}${suffix}`),
      }, '📁 Папка'),
      el('button', {
        type: 'button',
        class: 'btn btn-block create-choice',
        onClick: () => go(`#/new-record/${folderId}${suffix}`),
      }, '📝 Запись'),
    ],
    actions: [{ label: 'Отмена', onClick: () => m.close() }],
  });
}

// Выбор места для записи: верхний уровень хранилища или любая папка
function pickContainer({ folder, groups, currentId, onPick }) {
  const childrenOf = (pid) =>
    groups
      .filter((g) => (g.parentId || null) === pid)
      .sort((a, b) => a.createdAt - b.createdAt);

  const items = [];
  items.push(
    el('button', {
      type: 'button',
      class: 'btn btn-block container-choice' + (currentId ? '' : ' selected'),
      onClick: () => { m.close(); onPick(null); },
    },
      el('span', { class: 'container-main' },
        el('span', {}, folder.name),
        el('span', { class: 'muted' }, 'верхний уровень')
      )
    )
  );

  const walk = (pid, depth) => {
    childrenOf(pid).forEach((g) => {
      items.push(
        el('button', {
          type: 'button',
          class: 'btn btn-block container-choice' + (currentId === g.id ? ' selected' : ''),
          style: `padding-left:${14 + depth * 18}px`,
          onClick: () => { m.close(); onPick(g.id); },
        }, '📁 ' + g.name)
      );
      walk(g.id, depth + 1);
    });
  };
  walk(null, 0);

  if (!groups.length) {
    items.push(
      el('p', { class: 'muted' },
        'Папок пока нет. Создайте папку в хранилище — тогда записи можно будет в неё перемещать.')
    );
  }

  const m = modal({
    title: 'Переместить в…',
    content: items,
    actions: [{ label: 'Отмена', onClick: () => m.close() }],
  });
}

// ===== Экран: запись (создание / редактирование) =====

async function renderRecord(root, recordId, folderId, groupPath = []) {
  const record = recordId ? await DB.get('records', recordId) : null;
  if (recordId && !record) { location.hash = '#/'; return; }

  const fid = record ? record.folderId : folderId;
  const folder = await DB.get('folders', fid);
  if (!folder) { location.hash = '#/'; return; }

  const groups = await DB.groupsByFolder(fid);
  let groupId = record
    ? (record.groupId || null)
    : (groupPath.length ? groupPath[groupPath.length - 1] : null);
  const backUrl = containerUrl(fid, groupId ? pathIdsFor(groups, groupId) : []);
  const nameOf = (id) =>
    id ? (groups.find((g) => g.id === id)?.name || folder.name) : folder.name;
  const urlFor = (id) => containerUrl(fid, id ? pathIdsFor(groups, id) : []);

  // Загружаем списки для полей типа «Список»
  const lists = {};
  for (const f of folder.fields) {
    if (f.type === 'select' && f.listId && !lists[f.listId]) {
      lists[f.listId] = (await DB.get('lists', f.listId)) || { id: f.listId, name: '', options: [] };
    }
  }

  const getters = {};
  const formParts = [];

  for (const f of folder.fields) {
    const v = record ? record.values[f.id] : undefined;
    let control;

    if (f.type === 'text') {
      const input = el('input', { class: 'input', type: 'text', value: v ?? '' });
      control = input;
      getters[f.id] = () => input.value.trim();
    } else if (f.type === 'textarea') {
      const input = el('textarea', { class: 'input', rows: '3' }, v ?? '');
      control = input;
      getters[f.id] = () => input.value.trim();
    } else if (f.type === 'number') {
      const input = el('input', { class: 'input', type: 'number', inputmode: 'decimal', value: v ?? '' });
      control = input;
      getters[f.id] = () => input.value.trim();
    } else if (f.type === 'date') {
      const input = el('input', { class: 'input', type: 'date', value: v ?? '' });
      control = input;
      getters[f.id] = () => input.value;
    } else if (f.type === 'checkbox') {
      const input = el('input', { type: 'checkbox', checked: !!v });
      control = el('label', { class: 'check-row' }, input, el('span', {}, f.name));
      getters[f.id] = () => input.checked;
      formParts.push(el('div', { class: 'field-group' }, control));
      continue;
    } else if (f.type === 'select') {
      const list = lists[f.listId];
      const sel = el('select', { class: 'input' },
        el('option', { value: '' }, '— не выбрано —'),
        list.options.map((o) => el('option', { value: o, selected: v === o }, o))
      );
      // Значение, которого уже нет в списке — показываем как есть
      if (v && !list.options.includes(v)) {
        sel.append(el('option', { value: v, selected: true }, v));
      }
      if (v) sel.value = v;

      const addBtn = el('button', {
        type: 'button',
        class: 'btn btn-square',
        title: 'Добавить вариант',
        onClick: async () => {
          const name = await promptModal({
            title: `Новый вариант${list.name ? ': ' + list.name : ''}`,
          });
          if (!name) return;
          if (!list.options.includes(name)) {
            list.options.push(name);
            list.options.sort((a, b) => a.localeCompare(b, 'ru'));
            await DB.put('lists', list);
            sel.append(el('option', { value: name }, name));
          }
          sel.value = name;
        },
      }, '＋');

      control = el('div', { class: 'select-row' }, sel, addBtn);
      getters[f.id] = () => sel.value;
    }

    formParts.push(
      el('div', { class: 'field-group' },
        el('label', { class: 'field-label' }, f.name,
          f.required ? el('span', { class: 'req' }, ' *') : null),
        control
      )
    );
  }

  const noteInput = el('textarea', { class: 'input', rows: '3' }, record ? record.note || '' : '');
  formParts.push(
    el('div', { class: 'field-group' },
      el('label', { class: 'field-label' }, 'Примечание'),
      noteInput
    )
  );

  async function save() {
    const values = {};
    const missing = [];
    for (const f of folder.fields) {
      const val = getters[f.id]();
      if (f.required && f.type !== 'checkbox' && (val === '' || val === null || val === undefined)) {
        missing.push(f.name);
      }
      values[f.id] = val;
    }
    if (missing.length) {
      toast('Заполните: ' + missing.join(', '));
      return;
    }
    const now = Date.now();
    const rec = record
      ? { ...record, values, note: noteInput.value.trim(), groupId, updatedAt: now }
      : {
          id: DB.uid(), folderId: fid, groupId, values,
          note: noteInput.value.trim(), createdAt: now, updatedAt: now,
        };
    await DB.put('records', rec);
    toast('Сохранено');
    location.hash = urlFor(groupId);
  }

  // Выбор места: верхний уровень хранилища или любая папка (можно переместить запись)
  const placeValue = el('span', { class: 'place-value' }, nameOf(groupId));
  const placeControl = el('button', {
    type: 'button',
    class: 'place-row',
    onClick: () => pickContainer({
      folder,
      groups,
      currentId: groupId,
      onPick: (id) => { groupId = id; placeValue.textContent = nameOf(id); },
    }),
  },
    el('span', { class: 'place-icon' }, '📁'),
    el('span', { class: 'place-main' },
      el('span', { class: 'place-label' }, 'Место'),
      placeValue
    ),
    el('span', { class: 'place-change' }, 'Переместить')
  );

  const titleField = getTitleField(folder);
  const headerTitle = record
    ? String(record.values[titleField?.id] ?? '').trim() || 'Запись'
    : 'Новая запись';

  root.append(
    header({ title: headerTitle, color: folder.color, back: backUrl }),
    el('main', { class: 'content' },
      el('div', { class: 'form' },
        placeControl,
        formParts
      ),
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: save }, 'Сохранить'),
      record
        ? el('button', {
            type: 'button',
            class: 'btn btn-block',
            onClick: async () => {
              const now = Date.now();
              const copy = {
                id: DB.uid(),
                folderId: record.folderId,
                groupId,
                values: { ...record.values },
                note: record.note || '',
                createdAt: now,
                updatedAt: now,
              };
              await DB.put('records', copy);
              toast('Запись скопирована');
              location.hash = `#/record/${copy.id}`;
            },
          }, 'Дублировать запись')
        : null,
      record
        ? el('button', {
            type: 'button',
            class: 'btn btn-danger btn-block',
            onClick: async () => {
              const ok = await confirmModal({
                title: 'Удалить запись?',
                text: 'Действие нельзя отменить.',
                okText: 'Удалить',
                danger: true,
              });
              if (ok) {
                await DB.del('records', record.id);
                toast('Запись удалена');
                location.hash = urlFor(groupId);
              }
            },
          }, 'Удалить запись')
        : null
    )
  );
}

// ===== Экран: создание / редактирование папки =====

async function renderGroupEditor(root, groupId, folderId, parentPath = []) {
  let existing = null;
  let fid = folderId;
  let parentIds = parentPath;

  if (groupId) {
    existing = await DB.get('groups', groupId);
    if (!existing) { location.hash = '#/'; return; }
    fid = existing.folderId;
    const groups = await DB.groupsByFolder(fid);
    parentIds = pathIdsFor(groups, existing.id).slice(0, -1);
  }

  const folder = await DB.get('folders', fid);
  if (!folder) { location.hash = '#/'; return; }
  const parentId = parentIds.length ? parentIds[parentIds.length - 1] : null;

  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Например: Принтеры, 1 этаж, корпус А',
    value: existing ? existing.name : '',
  });

  async function save() {
    const name = nameInput.value.trim();
    if (!name) { toast('Введите название папки'); nameInput.focus(); return; }
    if (existing) {
      await DB.put('groups', { ...existing, name });
      toast('Папка обновлена');
      location.hash = containerUrl(fid, [...parentIds, existing.id]);
    } else {
      const g = { id: DB.uid(), folderId: fid, parentId, name, createdAt: Date.now() };
      await DB.put('groups', g);
      toast('Папка создана');
      location.hash = containerUrl(fid, [...parentIds, g.id]);
    }
  }

  root.append(
    header({
      title: existing ? 'Изменить папку' : 'Новая папка',
      color: folder.color,
      back: containerUrl(fid, parentIds),
    }),
    el('main', { class: 'content' },
      el('div', { class: 'form' },
        el('div', { class: 'field-group' },
          el('label', { class: 'field-label' }, 'Название'),
          nameInput
        ),
        el('p', { class: 'muted' },
          'Папка нужна, чтобы разделять записи внутри хранилища. Поля записей берутся из хранилища и не меняются.')
      ),
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: save },
        existing ? 'Сохранить изменения' : 'Создать папку'),
      existing
        ? el('div', { class: 'danger-zone' },
            el('button', {
              type: 'button',
              class: 'btn btn-danger btn-block',
              onClick: async () => {
                const ok = await confirmModal({
                  title: 'Удалить папку?',
                  text: 'Будут удалены папка, все вложенные папки и записи в них. Действие нельзя отменить.',
                  okText: 'Удалить',
                  danger: true,
                });
                if (ok) {
                  await DB.deleteGroupDeep(existing.id);
                  toast('Папка удалена');
                  location.hash = containerUrl(fid, parentIds);
                }
              },
            }, 'Удалить папку')
          )
        : null
    )
  );
}

// ===== Модалка: редактор поля =====

function editField(existing, lists) {
  return new Promise((resolve) => {
    const NEW_LIST = '__new__';
    const draft = existing
      ? { ...existing }
      : { id: DB.uid(), name: '', type: 'text', required: false, isTitle: false, listId: null };

    const nameInput = el('input', {
      class: 'input', type: 'text',
      placeholder: 'Например: Местоположение',
      value: draft.name,
    });

    const typeSel = el('select', { class: 'input' },
      Object.entries(FIELD_TYPES).map(([value, label]) =>
        el('option', { value, selected: draft.type === value }, label)
      )
    );

    const reqCheck = el('input', { type: 'checkbox', checked: !!draft.required });
    const titleCheck = el('input', { type: 'checkbox', checked: !!draft.isTitle });
    const reqRow = el('label', { class: 'check-row' }, reqCheck, el('span', {}, 'Обязательное поле'));
    const titleRow = el('label', { class: 'check-row' }, titleCheck,
      el('span', {}, 'Заголовок записи (показывать в списке)'));

    const listSel = el('select', { class: 'input' },
      lists.map((l) => el('option', { value: l.id, selected: draft.listId === l.id }, l.name)),
      el('option', { value: NEW_LIST }, '＋ Новый список…')
    );
    if (!draft.listId) listSel.value = lists.length ? lists[0].id : NEW_LIST;

    const newListInput = el('input', {
      class: 'input', type: 'text', placeholder: 'Название нового списка',
    });

    const listWrap = el('div', { class: 'field-group' },
      el('label', { class: 'field-label' }, 'Список вариантов'),
      listSel,
      newListInput
    );

    function refresh() {
      const t = typeSel.value;
      reqRow.style.display = t === 'checkbox' ? 'none' : '';
      titleRow.style.display = t === 'text' ? '' : 'none';
      listWrap.style.display = t === 'select' ? '' : 'none';
      newListInput.style.display = listSel.value === NEW_LIST ? '' : 'none';
    }
    typeSel.addEventListener('change', refresh);
    listSel.addEventListener('change', refresh);
    refresh();

    modal({
      title: existing ? 'Изменить поле' : 'Новое поле',
      content: [
        el('div', { class: 'field-group' }, el('label', { class: 'field-label' }, 'Название поля'), nameInput),
        el('div', { class: 'field-group' }, el('label', { class: 'field-label' }, 'Тип поля'), typeSel),
        listWrap,
        reqRow,
        titleRow,
      ],
      onCancel: () => resolve(null),
      actions: [
        { label: 'Отмена', onClick: ({ close }) => { close(); resolve(null); } },
        {
          label: 'Готово',
          class: 'btn btn-primary',
          onClick: async ({ close }) => {
            const name = nameInput.value.trim();
            if (!name) { toast('Введите название поля'); return; }
            draft.name = name;
            draft.type = typeSel.value;
            draft.required = draft.type === 'checkbox' ? false : reqCheck.checked;
            draft.isTitle = draft.type === 'text' ? titleCheck.checked : false;
            if (draft.type === 'select') {
              if (listSel.value === NEW_LIST) {
                const listName = newListInput.value.trim();
                if (!listName) { toast('Введите название нового списка'); return; }
                const created = { id: DB.uid(), name: listName, options: [] };
                await DB.put('lists', created);
                draft.listId = created.id;
              } else {
                draft.listId = listSel.value;
              }
            } else {
              draft.listId = null;
            }
            close();
            resolve(draft);
          },
        },
      ],
    });
    setTimeout(() => nameInput.focus(), 50);
  });
}

// ===== Экран: конструктор хранилища =====

async function renderFolderEditor(root, folderId) {
  const existing = folderId ? await DB.get('folders', folderId) : null;
  if (folderId && !existing) { location.hash = '#/'; return; }

  const folder = existing
    ? { ...existing, fields: existing.fields.map((f) => ({ ...f })) }
    : { id: DB.uid(), name: '', color: FOLDER_COLORS[5], fields: [], createdAt: Date.now() };

  const nameInput = el('input', {
    class: 'input', type: 'text',
    placeholder: 'Например: Оборудование',
    value: folder.name,
  });

  // Палитра
  const palette = el('div', { class: 'palette' });
  function renderPalette() {
    palette.innerHTML = '';
    FOLDER_COLORS.forEach((c) => {
      palette.append(
        el('button', {
          type: 'button',
          class: 'swatch' + (folder.color === c ? ' selected' : ''),
          style: `background:${c}`,
          'aria-label': `Цвет ${c}`,
          onClick: () => { folder.color = c; renderPalette(); },
        })
      );
    });
  }
  renderPalette();

  // Поля
  const fieldsList = el('div', { class: 'fields-list' });

  function renderFields() {
    fieldsList.innerHTML = '';
    if (folder.fields.length === 0) {
      fieldsList.append(el('p', { class: 'muted' }, 'Пока нет полей. Добавьте хотя бы одно.'));
    }
    folder.fields.forEach((f, idx) => {
      const badges = [];
      if (f.required) badges.push(el('span', { class: 'badge' }, 'обязательное'));
      if (f.isTitle && f.type === 'text') badges.push(el('span', { class: 'badge badge-title' }, 'заголовок'));

      fieldsList.append(
        el('div', { class: 'field-row' },
          el('button', { type: 'button', class: 'field-main', onClick: () => editFieldModal(f) },
            el('span', { class: 'field-name' }, f.name),
            el('span', { class: 'field-type' }, FIELD_TYPES[f.type]),
            badges.length ? el('span', { class: 'field-badges' }, badges) : null
          ),
          el('div', { class: 'field-actions' },
            el('button', {
              type: 'button', class: 'icon-btn', title: 'Выше', disabled: idx === 0,
              onClick: () => {
                [folder.fields[idx - 1], folder.fields[idx]] = [folder.fields[idx], folder.fields[idx - 1]];
                renderFields();
              },
            }, '↑'),
            el('button', {
              type: 'button', class: 'icon-btn', title: 'Ниже', disabled: idx === folder.fields.length - 1,
              onClick: () => {
                [folder.fields[idx + 1], folder.fields[idx]] = [folder.fields[idx], folder.fields[idx + 1]];
                renderFields();
              },
            }, '↓'),
            el('button', {
              type: 'button', class: 'icon-btn danger', title: 'Удалить поле',
              onClick: async () => {
                const ok = await confirmModal({
                  title: `Удалить поле «${f.name}»?`,
                  text: 'Введённые значения этого поля в записях пропадут из формы.',
                  okText: 'Удалить',
                  danger: true,
                });
                if (ok) { folder.fields.splice(idx, 1); renderFields(); }
              },
            }, '✕')
          )
        )
      );
    });
  }
  renderFields();

  async function editFieldModal(existingField) {
    const lists = await DB.getAll('lists');
    lists.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const result = await editField(existingField, lists);
    if (result) {
      const i = folder.fields.findIndex((f) => f.id === result.id);
      if (result.isTitle) folder.fields.forEach((f) => { f.isTitle = false; });
      if (i >= 0) folder.fields[i] = result;
      else folder.fields.push(result);
      renderFields();
    }
  }

  async function save() {
    const name = nameInput.value.trim();
    if (!name) { toast('Введите название хранилища'); nameInput.focus(); return; }
    if (folder.fields.length === 0) { toast('Добавьте хотя бы одно поле'); return; }
    folder.name = name;
    await DB.put('folders', folder);
    toast(existing ? 'Хранилище обновлено' : 'Хранилище создано');
    location.hash = `#/folder/${folder.id}`;
  }

  root.append(
    header({
      title: existing ? 'Изменить хранилище' : 'Новое хранилище',
      back: existing ? `#/folder/${folder.id}` : '#/',
    }),
    el('main', { class: 'content' },
      el('div', { class: 'form' },
        el('div', { class: 'field-group' }, el('label', { class: 'field-label' }, 'Название'), nameInput),
        el('div', { class: 'field-group' }, el('label', { class: 'field-label' }, 'Цвет'), palette),
        el('div', { class: 'field-group' },
          el('label', { class: 'field-label' }, 'Поля'),
          fieldsList,
          el('button', { type: 'button', class: 'btn', onClick: () => editFieldModal(null) }, '＋ Добавить поле')
        )
      ),
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: save },
        existing ? 'Сохранить изменения' : 'Создать хранилище'),
      existing
        ? el('div', { class: 'danger-zone' },
            el('button', {
              type: 'button',
              class: 'btn btn-danger btn-block',
              onClick: async () => {
                const count = (await DB.recordsByFolder(folder.id)).length;
                const ok = await confirmModal({
                  title: 'Удалить хранилище?',
                  text: `Будут удалены хранилище, все его папки и ${plural(count, 'запись', 'записи', 'записей')}. Действие нельзя отменить.`,
                  okText: 'Удалить',
                  danger: true,
                });
                if (ok) {
                  await DB.deleteRecordsByFolder(folder.id);
                  await DB.deleteGroupsByFolder(folder.id);
                  await DB.del('folders', folder.id);
                  toast('Хранилище удалено');
                  location.hash = '#/';
                }
              },
            }, 'Удалить хранилище')
          )
        : null
    )
  );
}

// ===== Экран: настройки =====

async function renderSettings(root) {
  const [lists, folders] = await Promise.all([DB.getAll('lists'), DB.getAll('folders')]);
  const lastExport = getLastExport();
  lists.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  root.append(header({ title: 'Настройки', back: '#/' }));
  const main = el('main', { class: 'content' });

  const refresh = () => { root.innerHTML = ''; renderSettings(root); };

  // --- Списки ---
  const listsSection = el('section', { class: 'card' },
    el('h2', {}, 'Списки вариантов'),
    el('p', { class: 'muted' }, 'Общие списки для полей типа «Список» — например, местоположения. Один список можно использовать в разных хранилищах.')
  );

  lists.forEach((list) => {
    const usedCount = folders.filter((f) =>
      f.fields.some((fl) => fl.type === 'select' && fl.listId === list.id)
    ).length;

    const chips = el('div', { class: 'chips' },
      list.options.length === 0
        ? el('span', { class: 'muted' }, 'Пусто')
        : list.options.map((o) =>
            el('span', { class: 'chip' }, o,
              el('button', {
                type: 'button', class: 'chip-x', 'aria-label': `Удалить «${o}»`,
                onClick: async () => {
                  list.options = list.options.filter((x) => x !== o);
                  await DB.put('lists', list);
                  refresh();
                },
              }, '✕')
            )
          )
    );

    const addInput = el('input', { class: 'input', type: 'text', placeholder: 'Новый вариант' });
    const addOption = async () => {
      const v = addInput.value.trim();
      if (!v) return;
      if (!list.options.includes(v)) {
        list.options.push(v);
        list.options.sort((a, b) => a.localeCompare(b, 'ru'));
        await DB.put('lists', list);
      }
      refresh();
    };
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addOption(); });

    listsSection.append(
      el('div', { class: 'list-card' },
        el('div', { class: 'list-head' },
          el('strong', {}, list.name),
          el('span', { class: 'muted' }, usedCount ? `в ${usedCount} хранилищ.` : 'не используется'),
          el('button', {
            type: 'button', class: 'icon-btn', title: 'Переименовать',
            onClick: async () => {
              const name = await promptModal({ title: 'Название списка', value: list.name });
              if (name) { list.name = name; await DB.put('lists', list); refresh(); }
            },
          }, '✎'),
          el('button', {
            type: 'button', class: 'icon-btn danger', title: 'Удалить список',
            disabled: usedCount > 0,
            onClick: async () => {
              const ok = await confirmModal({
                title: `Удалить список «${list.name}»?`,
                text: 'Введённые значения в записях сохранятся, но из вариантов пропадут.',
                okText: 'Удалить',
                danger: true,
              });
              if (ok) { await DB.del('lists', list.id); refresh(); }
            },
          }, '🗑')
        ),
        chips,
        el('div', { class: 'select-row' },
          addInput,
          el('button', { type: 'button', class: 'btn btn-small', onClick: addOption }, 'Добавить')
        )
      )
    );
  });

  listsSection.append(
    el('button', {
      type: 'button', class: 'btn',
      onClick: async () => {
        const name = await promptModal({ title: 'Название нового списка' });
        if (name) { await DB.put('lists', { id: DB.uid(), name, options: [] }); refresh(); }
      },
    }, '＋ Новый список')
  );

  // --- Резервные копии ---
  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: 'display:none',
    onChange: async (e) => {
      const file = e.target.files[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.folders) || !Array.isArray(data.records) || !Array.isArray(data.lists)) {
          throw new Error('bad format');
        }
        const ok = await confirmModal({
          title: 'Восстановить копию?',
          text: 'Все текущие данные будут заменены данными из файла.',
          okText: 'Восстановить',
          danger: true,
        });
        if (ok) {
          await DB.importAll(data);
          toast('Данные восстановлены');
          location.hash = '#/';
        }
      } catch (err) {
        console.error(err);
        toast('Не удалось прочитать файл');
      }
    },
  });

  const backupSection = el('section', { class: 'card' },
    el('h2', {}, 'Резервные копии'),
    el('p', { class: 'muted' }, 'Все данные хранятся только на этом устройстве. Регулярно сохраняйте копию.'),
    el('p', { class: 'muted' },
      lastExport
        ? `Последняя копия: ${new Date(lastExport).toLocaleDateString('ru-RU')}`
        : 'Копия ещё не создавалась'),
    el('button', {
      type: 'button', class: 'btn btn-primary btn-block',
      onClick: async () => {
        const data = await DB.exportAll();
        setLastExport(Date.now());
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = el('a', {
          href: url,
          download: `backup-${new Date().toISOString().slice(0, 10)}.json`,
        });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Файл сохранён');
      },
    }, 'Экспорт (скачать копию)'),
    el('button', {
      type: 'button', class: 'btn btn-block',
      onClick: () => fileInput.click(),
    }, 'Импорт (восстановить из файла)'),
    fileInput
  );

  // --- О приложении ---
  const aboutSection = el('section', { class: 'card' },
    el('h2', {}, 'О приложении'),
    el('p', { class: 'muted' }, 'Хранилище v1.4.0 (экспериментальная ветка). Работает офлайн, данные не покидают устройство.')
  );

  main.append(listsSection, backupSection, aboutSection);
  root.append(main);
}

// ===== Роутер =====

async function route() {
  const root = document.getElementById('app');
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  root.innerHTML = '';
  window.scrollTo(0, 0);

  try {
    if (parts.length === 0) return await renderHome(root);
    if (parts[0] === 'tasks') return await renderTasks(root);
    if (parts[0] === 'settings') return await renderSettings(root);
    if (parts[0] === 'new-folder') return await renderFolderEditor(root, null);
    if (parts[0] === 'folder' && parts[1] && parts[2] === 'edit') return await renderFolderEditor(root, parts[1]);
    if (parts[0] === 'folder' && parts[1]) return await renderFolder(root, parts[1], parts.slice(2));
    if (parts[0] === 'new-group' && parts[1]) return await renderGroupEditor(root, null, parts[1], parts.slice(2));
    if (parts[0] === 'edit-group' && parts[1]) return await renderGroupEditor(root, parts[1]);
    if (parts[0] === 'new-record' && parts[1]) return await renderRecord(root, null, parts[1], parts.slice(2));
    if (parts[0] === 'record' && parts[1]) return await renderRecord(root, parts[1]);
    location.hash = '#/';
  } catch (err) {
    console.error(err);
    root.append(
      el('main', { class: 'content' },
        el('div', { class: 'empty' },
          el('p', {}, 'Что-то пошло не так.'),
          el('p', {}, String(err && err.message || err))))
    );
  }
}

window.addEventListener('hashchange', route);
route();

// Цвет строки состояния под текущую тему (светлая/тёмная)
(function applyThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta || !window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => meta.setAttribute('content', mq.matches ? '#0f172a' : '#2563eb');
  if (mq.addEventListener) mq.addEventListener('change', update);
  update();
})();

if ('serviceWorker' in navigator) {
  // Когда новый service worker берёт управление, перезагружаем страницу,
  // чтобы сразу показать свежую версию приложения.
  let refreshed = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshed) return;
    refreshed = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => reg.update())
      .catch((err) => console.warn('SW:', err));
  });
}
