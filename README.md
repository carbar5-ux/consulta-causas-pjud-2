# Buscador de causas PJUD (extensión de Chrome)

Extensión de **uso personal** que busca causas en la **Consulta Unificada** de la Oficina Judicial Virtual del Poder Judicial de Chile usando solo el nombre de la persona. Recorre todas las competencias (Corte Suprema, Apelaciones, Civil, Laboral, Penal, Cobranza, etc.) y junta los resultados en un archivo para Excel.

Funciona sobre la misma página del PJUD que tú tienes abierta, con tu propia sesión de Chrome. No hay que instalar Python ni nada más.

## Instalación (una sola vez)

1. En este repo presiona **Code → Download ZIP** y descomprímelo.
2. En Chrome abre `chrome://extensions`.
3. Activa **Modo de desarrollador** (arriba a la derecha).
4. Presiona **Cargar descomprimida** y elige la carpeta descomprimida (la que contiene `manifest.json`).
5. Opcional: fija el ícono de la extensión en la barra (ícono de pieza de puzle → alfiler).

## Uso

1. Haz clic en el ícono de la extensión. Si no estás en el PJUD, se abre la Oficina Judicial Virtual.
2. Entra a **Consulta Unificada → Búsqueda por Nombre** (Persona Natural).
3. Abajo a la derecha aparece el panel **Buscador de causas**:
   - Escribe nombre(s), apellido paterno y apellido materno (y el año, si quieres).
   - Marca las competencias que quieres revisar (por defecto todas).
   - Opcional: en "Tribunal contiene" escribe por ejemplo `Santiago` para revisar solo esos tribunales cuando la competencia no tiene la opción "Todos".
4. Presiona **Buscar en todo** y deja la pestaña abierta. Verás el avance y las causas que va encontrando.
5. Si aparece un **captcha**, resuélvelo en la página: la búsqueda sigue sola.
6. Al terminar presiona **Descargar Excel (CSV)**.

El ícono de la extensión muestra u oculta el panel. Puedes pausar, continuar o detener en cualquier momento. Si la página se recarga, la búsqueda sigue desde donde iba.

## Cómo funciona

- Rellena el formulario de la página, cambia la competencia, deja la Corte en "Todas" y presiona **Buscar**.
- Si el formulario está dentro de un iframe, solo ese frame ejecuta la búsqueda; los demás no interfieren con el avance.
- Si el selector de Tribunal tiene la opción "Todos", hace una sola búsqueda por competencia. Si no, recorre cada tribunal.
- Lee la tabla de resultados (Rol, Fecha, Caratulado, Tribunal), incluida la paginación, y elimina duplicados.
- Reconoce los mensajes de “sin resultados” como una respuesta válida y continúa con la siguiente búsqueda, en vez de esperar hasta el timeout.
- Espera 3 segundos entre búsquedas para no saturar el sitio.
- Los datos quedan solo en tu navegador (no se envían a ningún servidor).

## Limitaciones

- La búsqueda por nombre puede traer **homónimos**: revisa cada causa.
- Las **causas reservadas** (gran parte de familia) no aparecen en la consulta pública.
- No resuelve captchas: los tienes que resolver tú.
- Si el PJUD cambia el diseño de la página, puede que haya que ajustar `content.js`. Si algo falla, abre la consola (F12 → Console) y busca mensajes `[Buscador PJUD]`.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `manifest.json` | Configuración de la extensión (solo tiene permiso sobre `oficinajudicialvirtual.pjud.cl`). |
| `background.js` | Clic en el ícono: abre el PJUD o muestra/oculta el panel. |
| `content.js` | Panel flotante y lógica de búsqueda sobre la página. |
| `icons/` | Íconos de la extensión. |
