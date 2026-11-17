/* Shared customer sheet tabs; filtering remains owned by each page. */
globalThis.QACustomerTabs = {
  sync(selectId) {
    const select = document.getElementById(selectId);
    const host = document.getElementById(selectId + 'Tabs');
    if (!select || !host) return;
    const codes = [...new Set(['MTK', 'MNT', 'BDR', ...Array.from(select.options, o => o.value).filter(Boolean)])];
    for (const code of codes) {
      if (!Array.from(select.options).some(o => o.value === code)) select.add(new Option(code, code));
    }
    if (!select.value) select.value = 'MTK';
    host.replaceChildren(...codes.map(code => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = code;
      button.className = 'customer-sheet-tab';
      button.setAttribute('aria-pressed', String(select.value === code));
      button.onclick = () => {
        select.value = code;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      };
      return button;
    }));
  }
};
