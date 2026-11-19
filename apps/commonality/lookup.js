for (const field of document.querySelectorAll('.lookup')) {
  const input = field.querySelector('input');
  const source = field.querySelector('datalist');
  const menu = field.querySelector('[role=listbox]');
  let active = -1;

  function close() {
    menu.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function show() {
    active = -1;
    input.removeAttribute('aria-activedescendant');
    const options = ['', ...Array.from(source.options, option => option.value)];
    menu.replaceChildren(...options.map((value, index) => {
      const row = document.createElement('div');
      row.id = input.id + '-option-' + index;
      row.dataset.value = value;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.textContent = value || field.dataset.all;
      return row;
    }));
    if (options.length === 1) {
      const empty = document.createElement('div');
      empty.className = 'lookup-empty';
      empty.textContent = '일치하는 항목 없음';
      menu.append(empty);
    }
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function choose(row) {
    input.value = row.dataset.value;
    input.dispatchEvent(new Event('input', {bubbles:true}));
    input.dispatchEvent(new Event('change', {bubbles:true}));
    close();
  }
  input.addEventListener('focus', show);
  input.addEventListener('click', show);
  input.addEventListener('input', show);
  input.addEventListener('blur', close);
  new MutationObserver(() => { if (!menu.hidden) show(); })
    .observe(source, {childList:true});
  menu.addEventListener('mousedown', event => event.preventDefault());
  menu.addEventListener('click', event => {
    const row = event.target.closest('[role=option]');
    if (row) choose(row);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Enter' && !menu.hidden && active >= 0) {
      event.preventDefault();
      choose(menu.children[active]);
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (menu.hidden) show();
    const rows = Array.from(menu.querySelectorAll('[role=option]'));
    active = active < 0 ? (event.key === 'ArrowDown' ? 0 : rows.length-1)
      : (active + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === active)));
    input.setAttribute('aria-activedescendant', rows[active].id);
    rows[active].scrollIntoView({block:'nearest'});
  });
}
