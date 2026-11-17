# Especificación: Registro de auditoría

| Campo | Valor |
| --- | --- |
| Componente | Registro de auditoría |
| Ubicación | `src/background/audit/` (registro), `src/popup/` (exportar y borrar) |
| Depende de | Motor de análisis (eventos `FlowEvent`), contratos compartidos |
| Lo usa | Popup (`docs/specs/popup-alertas.md`, sección 5.4) |
| Estado | Borrador para revisión del equipo |

## 1. Propósito

Los eventos del popup viven en `chrome.storage.session` y se pierden al cerrar Chrome. El registro de auditoría
guarda un **historial cifrado y encadenado** de los flujos detectados, que sobrevive al cierre del navegador y se
puede **exportar** como evidencia (STRIDE #3: repudio y borrado de eventos).

Decisiones del equipo (17/11/2026): clave AES-GCM interna, retención de 30 días con máximo 1000 registros y
exportación en JSON con verificación.

## 2. Qué se guarda

Una `AuditEntry` por cada `FlowEvent` publicado por el Motor (todas las severidades, incluidos los envíos normales,
para que el historial muestre también lo legítimo):

```ts
type AuditEntry = Omit<FlowEvent, "tabId">; // el tabId no tiene sentido fuera de la sesión
```

El `FlowEvent` ya excluye el valor, las huellas, la ruta y la consulta de la URL (motor, sección 5), así que el
registro **nunca** contiene datos sensibles (AGENTS.md, regla 1). Sí revela a qué sitios se enviaron credenciales:
por eso se cifra y se limita la retención.

## 3. Cadena y cifrado

- Cada registro tiene un número `seq` consecutivo y un `hash` = SHA-256 (hexadecimal) de
  `prevHash + "\n" + JSON canónico de la entrada` (claves ordenadas alfabéticamente). El primer registro de la
  historia usa `prevHash` = 64 ceros.
- Lo que se guarda en disco es `{ seq, at, iv, data }`: `at` es la hora en milisegundos (en claro, solo para la
  retención) y `data` es el cifrado AES-GCM de `{ entry, prevHash, hash }`, con un `iv` aleatorio de 12 bytes y como
  datos adicionales autenticados el texto `credflow-audit:<seq>`, para que un registro no pueda cambiarse de posición.
- La **cabeza** de la cadena (`{ lastSeq, lastHash }`) se guarda cifrada igual, con `credflow-audit:head`, para
  detectar que alguien borró los últimos registros.
- La clave es AES-GCM de 256 bits, generada con Web Crypto como **no exportable**, y se guarda en IndexedDB
  (`credflow-audit`) junto con los registros. Si falta la clave y hay registros, no se pueden leer: se borran y se
  empieza una cadena nueva.
- Las escrituras se hacen en orden (una cola), para que dos eventos seguidos no rompan la cadena.

**Alcance del cifrado.** Protege el historial frente a quien copia o lee los archivos del perfil de Chrome con
herramientas comunes. No protege frente a un programa malicioso con control total del equipo o del navegador, que
puede usar la clave igual que la extensión (riesgo aceptado, STRIDE #3).

## 4. Retención

- Al agregar un registro se eliminan los que tengan más de **30 días** y, si hay más de **1000**, los más antiguos.
- La retención borra desde el inicio de la cadena: la verificación acepta como ancla el `prevHash` del primer
  registro que queda y lo informa en la exportación.
- El usuario puede **borrar todo el historial** desde el popup; se borran registros, cabeza y clave.

## 5. Verificación

Recorre los registros por `seq` y comprueba, en este orden:

1. que se puedan descifrar (si no, `problem: "decrypt"`);
2. que los `seq` sean consecutivos (si no, `problem: "gap"`);
3. que cada `prevHash` sea el `hash` del anterior y que el `hash` recalculado coincida (si no, `problem: "hash"`);
4. que el último coincida con la cabeza (si no, `problem: "head"`).

Resultado: `{ valid, problem, count, firstSeq, lastSeq, anchor }`, donde `problem` es `null` si todo está bien y
`anchor` es el `prevHash` del primer registro.

## 6. Exportación

El popup pide la exportación al Service Worker y descarga un archivo
`credflow-auditoria-AAAAMMDD-HHMMSS.json` con un enlace `blob:` (sin permiso `downloads`):

```ts
type AuditExport = {
  format: "credflow-audit/1";
  exportedAt: string; // ISO 8601
  algorithm: string;  // descripción de la fórmula del hash, para verificarlo fuera de la extensión
  verification: AuditVerification;
  records: Array<{ seq: number; prevHash: string; hash: string; entry: AuditEntry }>;
};
```

El archivo exportado contiene las entradas en claro (metadatos, nunca valores) y sus hashes, de modo que cualquiera
puede recalcular la cadena. `verifyExport` hace esa comprobación sobre un archivo exportado.

## 7. Mensajes

| Mensaje (popup → Service Worker) | Respuesta |
| --- | --- |
| `{ kind: "AUDIT_STATUS" }` | `{ count, oldest, newest }` (horas ISO o `null`) |
| `{ kind: "AUDIT_EXPORT" }` | `AuditExport` |
| `{ kind: "AUDIT_CLEAR" }` | `{ cleared: true }` |

Se validan con esquema estricto (exactamente la clave `kind`) y solo se atienden si el remitente es una página de la
propia extensión (`isExtensionPageSender`), igual que `GET_TAB_EVENTS`. Un content script no puede leer, exportar ni
borrar el historial.

## 8. Controles de seguridad

| Control | Referencia |
| --- | --- |
| Solo metadatos de `FlowEvent`: ningún valor, huella, ruta ni consulta | AGENTS.md regla 1; STRIDE #4 |
| Cifrado AES-GCM con clave no exportable; posición autenticada con `seq` | ASVS 4.0.3 V6.2.1, V6.2.5 |
| Cadena SHA-256 y cabeza cifrada para detectar alteración, borrado o truncamiento | ASVS 4.0.3 V7.3.3; STRIDE #3 |
| Retención de 30 días y 1000 registros; borrado total por el usuario | ASVS 4.0.3 V8.3.8 |
| Solo páginas de la extensión pueden exportar o borrar | ASVS 4.0.3 V4.1.3; STRIDE #1 |
| Un error al guardar no detiene el análisis ni el popup | AGENTS.md regla 8 |
| Sin permisos nuevos (IndexedDB y descarga con `blob:` no los requieren) | AGENTS.md regla 7 |

## 9. Criterios de aceptación

- **CA-A1** Tres registros agregados forman una cadena válida: `seq` 1, 2, 3, el primero con `prevHash` de 64 ceros
  y cada `prevHash` igual al `hash` anterior.
- **CA-A2** Lo guardado en disco no contiene en claro el sitio, el destino ni el veredicto de la entrada.
- **CA-A3** Alterar un byte de `data` produce `problem: "decrypt"`; mover un registro a otro `seq` también.
- **CA-A4** Borrar un registro intermedio produce `problem: "gap"`; borrar el último produce `problem: "head"`.
- **CA-A5** Al agregar, se eliminan los registros de más de 30 días y se conservan como máximo 1000; la cadena que
  queda sigue siendo válida con su ancla.
- **CA-A6** La exportación incluye las entradas, la verificación y el algoritmo; `verifyExport` la acepta, y la
  rechaza si se cambia el veredicto de una entrada.
- **CA-A7** Ninguna entrada contiene `tabId`, el valor ni una huella (prueba que serializa el registro y busca la
  huella).
- **CA-A8** El validador de mensajes acepta los tres mensajes y rechaza claves adicionales o `kind` desconocido.
- **CA-A9** Sin clave y con registros, se borran y la cadena empieza de nuevo en `seq` 1.
- **CA-A10 (E2E)** Tras el escenario `robo`, el popup muestra el número de eventos guardados y «Exportar» descarga un
  JSON con la entrada `third_party` y `verification.valid: true`; tras «Borrar historial» queda en 0.

## 10. Fuera de alcance

- Frase de paso del usuario y sincronización entre equipos.
- Firmar la exportación con una clave asimétrica.
- Mostrar el historial completo en una página propia (solo se exporta).
