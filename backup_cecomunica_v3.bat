@echo off
setlocal enabledelayedexpansion

:: === Fecha y hora para nombre del backup ===
for /f %%i in ('powershell -command "Get-Date -Format yyyy-MM-dd_HH-mm"') do set datetime=%%i
set "folderName=backup_%datetime%"

:: Carpeta destino de backups
set "backupDir=%cd%\backups"
if not exist "%backupDir%" mkdir "%backupDir%"

:: Carpeta temporal para armar el backup
set "fullPath=%backupDir%\%folderName%"
set "zipPath=%backupDir%\%folderName%.zip"

echo Creando carpeta temporal "%fullPath%" ...
mkdir "%fullPath%"

:: === Copia raíz del proyecto ===
echo Copiando archivos raíz...
copy /Y *.html "%fullPath%" 
copy /Y *.css "%fullPath%" 
copy /Y *.js "%fullPath%" 
copy /Y *.json "%fullPath%" 
copy /Y *.txt "%fullPath%" 
copy /Y *.md "%fullPath%" 
copy /Y firebase.json "%fullPath%" 
copy /Y .firebaserc "%fullPath%" 
copy /Y firestore.rules "%fullPath%" 
copy /Y firestore.indexes.json "%fullPath%" 
copy /Y storage.rules "%fullPath%" 
copy /Y package*.json "%fullPath%" 
copy /Y .gcloudignore "%fullPath%" 
copy /Y .gitignore "%fullPath%" 

:: === Carpetas de frontend comunes ===
echo Copiando frontend...
xcopy "public"     "%fullPath%\public"     /E /I /Y
xcopy "js"         "%fullPath%\js"         /E /I /Y
xcopy "css"        "%fullPath%\css"        /E /I /Y
if exist "public\img"   xcopy "public\img"   "%fullPath%\public\img"   /E /I /Y
if exist "public\fonts" xcopy "public\fonts" "%fullPath%\public\fonts" /E /I /Y

:: === Copia carpetas de módulos ===
echo Copiando módulos...
if exist "ordenes"    xcopy "ordenes"    "%fullPath%\ordenes"    /E /I /Y
if exist "POC"        xcopy "POC"        "%fullPath%\POC"        /E /I /Y
if exist "inventario" xcopy "inventario" "%fullPath%\inventario" /E /I /Y
if exist "contratos"  xcopy "contratos"  "%fullPath%\contratos"  /E /I /Y

:: === Copia solo lo esencial de Cloud Functions ===
if exist "functions" (
  echo Copiando funciones esenciales...
  mkdir "%fullPath%\functions" >nul 2>&1
  for %%f in (index.js *.js) do (
    if exist "functions\%%f" copy "functions\%%f" "%fullPath%\functions" >nul
  )
  if exist "functions\package.json" copy "functions\package.json" "%fullPath%\functions" >nul
  if exist "functions\package-lock.json" copy "functions\package-lock.json" "%fullPath%\functions" >nul
  if exist "functions\templates" xcopy "functions\templates" "%fullPath%\functions\templates" /E /I /Y
  if exist "functions\utils"     xcopy "functions\utils"     "%fullPath%\functions\utils"     /E /I /Y
  echo ✅ Functions copiadas.
) else (
  echo ⚠️  Carpeta "functions" no encontrada, se omite.
)
:: === Crear archivo ZIP con PowerShell ===
echo Comprimiendo backup en "%zipPath%" ...
powershell -NoLogo -NoProfile -Command ^
 "& { Compress-Archive -Path \"%fullPath%\*\" -DestinationPath \"%zipPath%\" -Force }"

if exist "%zipPath%" (
  rmdir /s /q "%fullPath%"
  echo.
  echo ✅ Backup completo creado: "%zipPath%"
) else (
  echo ❌ Error creando ZIP. Carpeta temporal preservada: "%fullPath%"
)

pause

