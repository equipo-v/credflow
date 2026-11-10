# Documentación de CredFlow

Documentación de cómo funciona la extensión CredFlow. Si vas a usarla, empieza por el **manual de uso**; si quieres
entender cómo detecta las fugas por dentro, lee la **arquitectura**.

| Documento | Para qué sirve |
| --- | --- |
| [Manual de uso](manual/manual-de-uso.md) | Instalar CredFlow, leer sus alertas, configurar proveedores autorizados y probarlo en el laboratorio. |
| [Arquitectura](arquitectura.md) | Componentes de la extensión, recorrido de un dato sensible, reglas de clasificación y controles de seguridad. |
| [Modelo de amenazas STRIDE](stride.md) | Amenazas contra la propia extensión y los controles que la protegen. |

## Especificaciones de los componentes (`specs/`)

| Especificación | Componente |
| --- | --- |
| [puente-mensajes.md](specs/puente-mensajes.md) | Puente de mensajes: detecta lo que el usuario escribe |
| [motor-analisis.md](specs/motor-analisis.md) | Motor de análisis: revisa las peticiones salientes |
| [popup-alertas.md](specs/popup-alertas.md) | Popup y alertas en el ícono |
| [laboratorio.md](specs/laboratorio.md) | Laboratorio de pruebas |

## Verificación técnica

[webrequest-requestbody.md](verificaciones/webrequest-requestbody.md): qué partes del cuerpo de una petición entrega
Chrome a la extensión. Chrome no entrega el contenido de `Blob`, `File` ni `ReadableStream`; por eso existe la alerta
de envío no inspeccionable.
