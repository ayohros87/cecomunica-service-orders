@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: Backup local de cecomunica-service-orders (v4)
:: Estructura actual: public/ (frontend), functions/ (src, scripts,
:: templates, tests), docs/, design-system/ y config raiz.
:: Excluye node_modules, .git, .firebase y backups/.
:: ============================================================

:: === Fecha y hora para nombre del backup ===
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm"') do set datetime=%%i
set "folderName=backup_%datetime%"

:: Carpeta destino de backups
set "backupDir=%cd%\backups"
if not exist "%backupDir%" mkdir "%backupDir%"

:: Carpeta temporal para armar el backup
set "fullPath=%backupDir%\%folderName%"
set "zipPath=%backupDir%\%folderName%.zip"

echo Creando carpeta temporal "%fullPath%" ...
mkdir "%fullPath%"

:: === Config y docs de la raiz ===
echo Copiando archivos raiz...
copy /Y firebase.json "%fullPath%" >nul
copy /Y .firebaserc "%fullPath%" >nul
copy /Y firestore.rules "%fullPath%" >nul
copy /Y firestore.indexes.json "%fullPath%" >nul
copy /Y storage.rules "%fullPath%" >nul
copy /Y jsconfig.json "%fullPath%" >nul
copy /Y .gitignore "%fullPath%" >nul
copy /Y .gitattributes "%fullPath%" >nul
copy /Y *.md "%fullPath%" >nul
copy /Y *.local.json "%fullPath%" >nul 2>nul
copy /Y backup_cecomunica_v3.bat "%fullPath%" >nul

:: === Frontend completo (incluye brand/kpi report, que NO esta en git) ===
echo Copiando public...
xcopy "public" "%fullPath%\public" /E /I /Y /Q

:: === Documentacion ===
if exist "docs" xcopy "docs" "%fullPath%\docs" /E /I /Y /Q

:: === Design system ===
if exist "design-system" xcopy "design-system" "%fullPath%\design-system" /E /I /Y /Q

:: === Cloud Functions (sin node_modules) ===
if exist "functions" (
  echo Copiando functions...
  mkdir "%fullPath%\functions" >nul 2>&1
  copy /Y "functions\index.js" "%fullPath%\functions" >nul
  copy /Y "functions\package.json" "%fullPath%\functions" >nul
  copy /Y "functions\package-lock.json" "%fullPath%\functions" >nul
  copy /Y "functions\eslint.config.js" "%fullPath%\functions" >nul 2>nul
  if exist "functions\src"           xcopy "functions\src"           "%fullPath%\functions\src"           /E /I /Y /Q
  if exist "functions\scripts"       xcopy "functions\scripts"       "%fullPath%\functions\scripts"       /E /I /Y /Q
  if exist "functions\templates"     xcopy "functions\templates"     "%fullPath%\functions\templates"     /E /I /Y /Q
  if exist "functions\test"          xcopy "functions\test"          "%fullPath%\functions\test"          /E /I /Y /Q
  if exist "functions\test-emulator" xcopy "functions\test-emulator" "%fullPath%\functions\test-emulator" /E /I /Y /Q
) else (
  echo AVISO: carpeta "functions" no encontrada, se omite.
)

:: === Crear archivo ZIP con PowerShell ===
echo Comprimiendo backup en "%zipPath%" ...
powershell -NoLogo -NoProfile -Command "Compress-Archive -Path '%fullPath%\*' -DestinationPath '%zipPath%' -Force"

if exist "%zipPath%" (
  rmdir /s /q "%fullPath%"
  echo.
  echo OK - Backup completo creado: "%zipPath%"
) else (
  echo ERROR creando ZIP. Carpeta temporal preservada: "%fullPath%"
)

pause
