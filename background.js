// Al hacer clic en el ícono: si estás en el PJUD, muestra/oculta el panel;
// si no, abre la Oficina Judicial Virtual en una pestaña nueva.
const PJUD = 'https://oficinajudicialvirtual.pjud.cl/';
const INICIO = PJUD + 'indexN.php';

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.startsWith(PJUD)) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'toggle' }, { frameId: 0 });
    } catch (e) {
      // La página aún no cargó el script (p. ej. recién instalada): recargar.
      chrome.tabs.reload(tab.id);
    }
  } else {
    chrome.tabs.create({ url: INICIO });
  }
});
