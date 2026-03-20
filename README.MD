# Pullman Bus · Pago Empresarios — Deploy en Vercel

---

## Estructura de archivos (exacta)

```
pullman-dashboard/
├── index.html
├── script.js
├── style.css
├── api/
│   ├── auth.js
│   └── proxy.js
├── vercel.json
├── .gitignore          ← renombrar gitignore.txt → .gitignore
└── .env.example        ← renombrar env.example → .env.example
```

> ⚠️ La carpeta `api/` debe estar en la raíz del proyecto.
> Vercel la detecta automáticamente y convierte cada .js en una serverless function.

---

## PASO 1 — Preparar archivos locales

1. Descarga todos los archivos
2. Crea la carpeta `pullman-dashboard/`
3. Dentro crea la subcarpeta `api/`
4. Coloca los archivos así:

```
pullman-dashboard/
├── index.html        ← aquí
├── script.js         ← aquí
├── style.css         ← aquí
├── vercel.json       ← aquí
├── api/
│   ├── auth.js       ← aquí
│   └── proxy.js      ← aquí
```

5. Renombra los archivos especiales:
   - `gitignore.txt`  →  `.gitignore`
   - `env.example`    →  `.env.example`

---

## PASO 2 — Generar el APP_SECRET

Abre una terminal y ejecuta:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copia el resultado (64 caracteres hex). Lo necesitarás en el Paso 5.

Ejemplo de output:
```
a3f8c2d1e4b70923f1d6e5c8b2a14d7e9f03c2b1a8e5d4c7b6a3f2e1d0c9b8a7
```

---

## PASO 3 — Subir a GitHub

```bash
# Entrar a la carpeta
cd pullman-dashboard

# Inicializar git
git init

# Agregar todos los archivos
git add .

# Primer commit
git commit -m "feat: pago empresarios dashboard v2"
```

Ahora ve a [github.com](https://github.com) y:
1. Click en **"New repository"**
2. Nombre: `pullman-dashboard` (o el que prefieras)
3. Visibilidad: **Private** ✅
4. **NO** marcar "Add a README file"
5. Click **"Create repository"**

GitHub te mostrará comandos. Ejecuta los de "push an existing repository":

```bash
git remote add origin https://github.com/TU_USUARIO/pullman-dashboard.git
git branch -M main
git push -u origin main
```

---

## PASO 4 — Crear proyecto en Vercel

1. Ve a [vercel.com](https://vercel.com) e inicia sesión
2. Click en **"Add New..."** → **"Project"**
3. En "Import Git Repository" busca `pullman-dashboard` y click **"Import"**
4. En la pantalla de configuración:
   - **Framework Preset:** `Other`  
   - **Root Directory:** `.` (dejar por defecto)
   - **Build Command:** *(dejar completamente vacío)*
   - **Output Directory:** *(dejar completamente vacío)*
   - **Install Command:** *(dejar completamente vacío)*

⛔ **No hacer click en Deploy todavía** — primero agregar las variables de entorno.

---

## PASO 5 — Agregar variables de entorno en Vercel

En la misma pantalla de configuración, busca la sección **"Environment Variables"** y agrega estas 6 variables una por una:

| Nombre                  | Valor                                          |
|-------------------------|------------------------------------------------|
| `APP_USER`              | El usuario de login (ej: `contabilidad`)       |
| `APP_PASS`              | Una contraseña segura (ej: `Pullman#2026!`)    |
| `APP_SECRET`            | El hex de 64 chars generado en el Paso 2       |
| `KONNECT_BEARER_TOKEN`  | El Bearer token completo de Konnect Pro        |
| `KONNECT_API_KEY`       | `QHH79qF2fsWEx98pvNeZpQ`                      |
| `NODE_ENV`              | `production`                                   |

Para cada variable:
1. Escribe el nombre en el campo "Name"
2. Pega el valor en el campo "Value"
3. Asegúrate que esté marcado: ✅ Production ✅ Preview ✅ Development
4. Click **"Add"**

---

## PASO 6 — Deploy

Click en el botón **"Deploy"**.

Vercel mostrará los logs en tiempo real. El build exitoso se ve así:

```
✓ Running "vercel build"
✓ Building...
✓ Deploying...
✓ Production deployment available at: https://pullman-dashboard-xxx.vercel.app
```

Si el deploy falla, ver sección "Errores comunes" al final.

---

## PASO 7 — Verificar que funciona

### 7.1 Probar el login
1. Abre la URL de Vercel
2. Ingresa el usuario y contraseña que pusiste en `APP_USER` / `APP_PASS`
3. Debes ver el dashboard

### 7.2 Verificar que las keys NO están expuestas
1. En el dashboard, abre DevTools (F12)
2. Ve a la pestaña **"Sources"** (o "Fuentes")
3. Abre `script.js`
4. Busca (Ctrl+F): `Bearer`, `KONNECT`, `QHH79`, `api-key`
5. ✅ No debe aparecer ninguna de estas cadenas

### 7.3 Verificar el proxy
1. Ve a la pestaña **"Network"** en DevTools
2. Haz click en "Cargar" en el dashboard
3. Observa los requests — deben ir a `/api/proxy?path=...`
4. Click en cualquier request → Headers
5. ✅ NO debe aparecer `authorization: Bearer ...` ni `x-api-key` en los request headers del navegador

---

## PASO 8 — Dominio personalizado (opcional)

En Vercel → tu proyecto → **"Settings"** → **"Domains"**:
1. Agregar tu dominio (ej: `pagos.pullmanbus.cl`)
2. Seguir las instrucciones para configurar DNS
3. Actualizar la variable `ALLOWED_ORIGINS` con el nuevo dominio

---

## Errores comunes y soluciones

### ❌ "Build failed" en Vercel
**Causa:** El `vercel.json` tiene algún error de sintaxis.  
**Solución:** Verifica que el archivo no fue modificado. Debe tener exactamente las keys: `version`, `name`, `functions`, `rewrites`, `headers`.

### ❌ "Server misconfigured" al hacer login
**Causa:** Las variables de entorno no se configuraron correctamente.  
**Solución:**  
1. Vercel → proyecto → Settings → Environment Variables
2. Verifica que existen `APP_USER`, `APP_PASS`, `APP_SECRET`
3. Después de modificar variables: **Deployments → el último → "Redeploy"**

### ❌ "Credenciales incorrectas" aunque son correctas
**Causa:** Espacios o caracteres extra al copiar/pegar el valor.  
**Solución:** En Vercel → Environment Variables → edita cada variable y asegúrate de no tener espacios al inicio o final.

### ❌ "Sesión inválida" inmediatamente después de login
**Causa:** `APP_SECRET` tiene espacios o fue truncado al copiarlo.  
**Solución:** Regenerar el APP_SECRET (Paso 2) y actualizar en Vercel → Redeploy.

### ❌ Los datos no cargan (rueda giratoria infinita)
**Causa:** `KONNECT_BEARER_TOKEN` expiró.  
**Solución:** Obtener un nuevo token de Konnect Pro y actualizar la variable en Vercel → Redeploy.

---

## Rotar credenciales

Si sospechas que algo se filtró:

```bash
# Generar nuevo APP_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Actualizar en Vercel → Environment Variables → APP_SECRET → Save → Redeploy.  
Esto invalida **todas las sesiones activas** de inmediato.