# 🧠 Corrector Ortográfico para Redes Sociales (Facebook + Instagram)

## 📌 Descripción

Extensión de navegador que corrige errores ortográficos en tiempo real mientras escribes en Facebook y Instagram.

Detecta texto en campos editables (comentarios, publicaciones y chat) y sugiere correcciones basadas en análisis lingüístico, permitiendo reemplazar palabras con un solo clic sin interrumpir la escritura.

---

## 🚀 Características principales

* ✍️ **Corrección en tiempo real** mientras escribes
* 🔍 **Detección automática de errores ortográficos**
* 💡 **Sugerencias inteligentes** (ej: "habia" → "había")
* 🖱️ **Reemplazo con un clic** sin borrar el contenido
* ⚡ **Optimizado para inputs dinámicos (`contentEditable`)**
* 🌐 Soporte multi-plataforma:

  * Facebook (posts, comentarios, chat)
  * Instagram (comentarios y mensajes web)

---

## 🧠 ¿Cómo funciona?

1. La extensión detecta campos editables (`contentEditable`)
2. Identifica la plataforma activa (Facebook o Instagram)
3. Captura el texto mientras el usuario escribe
4. Envía el contenido a un motor de corrección (LanguageTool)
5. Recibe errores con:

   * posición (`offset`)
   * longitud (`length`)
   * sugerencias
6. Muestra visualmente los errores
7. Permite reemplazar palabras de forma segura sin romper el DOM

---

## 🛠️ Tecnologías utilizadas

* JavaScript (Vanilla)
* Chrome Extension (Manifest V3)
* API de LanguageTool
* Manejo avanzado de `contentEditable`
* Observación de DOM con `MutationObserver`

---

## ⚠️ Retos técnicos resueltos

Este proyecto aborda problemas complejos típicos de aplicaciones modernas:

* 🧩 DOM dinámico (React en redes sociales)
* 🔄 Re-render constante que rompe referencias
* 🎯 Reemplazo parcial sin borrar contenido
* 🧵 Manejo de offsets inconsistentes
* ⌨️ Preservación del cursor y foco
* 🔍 Detección precisa de inputs reales en Instagram

---

## 🧪 Estrategia de reemplazo (clave)

Para evitar errores como:

* borrar todo el texto
* no aplicar cambios

Se implementa un sistema híbrido robusto:

* ✅ Reemplazo por posición (`offset`)
* 🔁 Fallback por coincidencia de texto
* 🔒 Validaciones antes de aplicar cambios
* ⚡ Simulación de eventos de entrada (`InputEvent`)
* 🧠 Relectura del DOM en tiempo real antes de reemplazar

---

## 🧩 Soporte por plataforma

### 🔵 Facebook

* Publicaciones
* Comentarios
* Chat (Messenger web)

### 🟣 Instagram

* Comentarios en publicaciones
* Mensajes directos (DMs web)

---

## 📦 Instalación (modo desarrollador)

1. Clonar o descargar el repositorio
2. Ir a `chrome://extensions/`
3. Activar **Modo desarrollador**
4. Click en **Cargar descomprimida**
5. Seleccionar la carpeta del proyecto

---

## 📁 Estructura del proyecto

```id="p3g5yd"
spellcheck-extension/
│
├── manifest.json
├── content.js
├── background.js
├── styles.css
└── utils/
    └── spellcheck.js
```

---

## 🔒 Privacidad

* No se almacenan datos del usuario
* El texto se procesa en tiempo real
* Puede enviarse a servicios externos de corrección lingüística
* No se guarda historial de escritura

---

## 🚀 Roadmap

* [x] Soporte Facebook
* [x] Soporte Instagram (fase inicial)
* [ ] Corrección gramatical avanzada
* [ ] Reescritura con IA (tono profesional)
* [ ] Soporte para más plataformas (Twitter/X, LinkedIn)
* [ ] Panel de configuración

---

## 💡 Visión

Convertirse en una alternativa ligera a herramientas como Grammarly enfocada en español y optimizada para redes sociales.

---

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Puedes proponer mejoras en:

* rendimiento
* soporte de plataformas
* experiencia de usuario
* nuevas funcionalidades

---

## 📄 Licencia

MIT

---
