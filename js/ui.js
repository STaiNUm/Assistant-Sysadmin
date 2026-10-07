// ===== UI-хелперы: DOM, модалки, тосты =====

// Создание элемента: el('div', { class: 'x', onClick: fn }, child1, child2, ...)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function')
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = value;
    else if (key === 'disabled') node.disabled = true;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Базовая модалка. onCancel срабатывает при клике на затемнённый фон.
export function modal({ title, content, actions = [], onCancel }) {
  const root = document.getElementById('modal-root');
  const close = () => { root.innerHTML = ''; };
  const cancel = () => { close(); if (onCancel) onCancel(); };

  const overlay = el('div', {
    class: 'modal-overlay',
    onClick: (e) => { if (e.target === overlay) cancel(); },
  },
    el('div', { class: 'modal' },
      title ? el('h3', {}, title) : null,
      el('div', { class: 'modal-body' }, content),
      actions.length
        ? el('div', { class: 'modal-actions' },
            actions.map((a) =>
              el('button', {
                class: a.class || 'btn',
                type: 'button',
                onClick: () => a.onClick({ close, cancel }),
              }, a.label)
            )
          )
        : null
    )
  );

  root.innerHTML = '';
  root.append(overlay);
  return { close, cancel };
}

// Подтверждение: true / false
export function confirmModal({ title, text, okText = 'ОК', cancelText = 'Отмена', danger = false }) {
  return new Promise((resolve) => {
    modal({
      title,
      content: text ? el('p', {}, text) : [],
      onCancel: () => resolve(false),
      actions: [
        { label: cancelText, onClick: ({ close }) => { close(); resolve(false); } },
        {
          label: okText,
          class: danger ? 'btn btn-danger' : 'btn btn-primary',
          onClick: ({ close }) => { close(); resolve(true); },
        },
      ],
    });
  });
}

// Ввод строки: string / null
export function promptModal({ title, placeholder = '', value = '' }) {
  return new Promise((resolve) => {
    const input = el('input', { class: 'input', type: 'text', placeholder, value });
    let m;
    const submit = () => {
      const v = input.value.trim();
      m.close();
      resolve(v || null);
    };
    const form = el('form', { onSubmit: (e) => { e.preventDefault(); submit(); } }, input);
    m = modal({
      title,
      content: [form],
      onCancel: () => resolve(null),
      actions: [
        { label: 'Отмена', onClick: ({ close }) => { close(); resolve(null); } },
        { label: 'Готово', class: 'btn btn-primary', onClick: () => submit() },
      ],
    });
    setTimeout(() => input.focus(), 50);
  });
}

// Тост-уведомление
let toastTimer = null;
export function toast(message) {
  let node = document.querySelector('.toast');
  if (!node) {
    node = el('div', { class: 'toast' });
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

// Русский плюрализм: plural(5, 'запись', 'записи', 'записей')
export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}
