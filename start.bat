@echo off
rem Double-click this file to start CropKit on Windows.
rem The first run sets things up (1-3 minutes); afterwards it starts in a few seconds.
setlocal EnableExtensions
title CropKit
cd /d "%~dp0"
set "APP=%~dp0"

rem --- Started from inside the downloaded .zip? (Windows then runs it from a temporary folder)
echo "%APP%" | find /i "\AppData\Local\Temp" >nul && goto :inzip

rem --- Python: the "py" launcher of python.org first, then "python"
set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY goto :nopython
set "PYEXE="
for /f "delims=" %%i in ('%PY% -c "import sys; print(sys.executable)"') do set "PYEXE=%%i"

if exist ".git" ( set GIT_TERMINAL_PROMPT=0& git pull --ff-only --quiet 2>nul )

rem --- CropKit's libraries live in their own folder in your user folder, NOT inside the CropKit folder:
rem     that folder may be in OneDrive, a linked folder or a redirected one, which breaks or freezes the setup.
set "VENV=%USERPROFILE%\.cropkit\venv"
set "VPY=%VENV%\Scripts\python.exe"
set "SYSMARK=%USERPROFILE%\.cropkit\use-system-python"
if exist "%SYSMARK%" goto :system

"%VPY%" -c "import sys" >nul 2>nul && goto :deps

echo.
echo  First start: setting up CropKit - 1 to 3 minutes, only this once.
echo    Python used:          %PYEXE%
echo    CropKit's libraries:  %VENV%
echo "%PYEXE%" | find /i "WindowsApps" >nul && (
  echo.
  echo    Note: this is the Microsoft Store version of Python. If the setup fails, install Python from
  echo    https://www.python.org/downloads/ - tick "Add python.exe to PATH" - and start again.
)
echo.
echo  [1/2] Creating CropKit's environment...
if exist "%VENV%" rmdir /s /q "%VENV%"
if not exist "%USERPROFILE%\.cropkit" mkdir "%USERPROFILE%\.cropkit"
%PY% -m venv "%VENV%"
"%VPY%" -m pip --version >nul 2>nul || goto :novenv

:deps
fc /b requirements.txt "%VENV%\requirements.installed" >nul 2>nul && goto :run
echo.
echo  [2/2] Downloading the libraries CropKit needs - flask, pillow, numpy, ffmpeg. Progress below:
echo.
"%VPY%" -m pip install --disable-pip-version-check --timeout 60 -r requirements.txt || goto :pipfail
copy /y requirements.txt "%VENV%\requirements.installed" >nul
echo.
echo  Setup finished.

:run
echo.
echo  Starting CropKit... You can minimise this window. Closing it stops CropKit.
"%VPY%" app.py %*
pause
exit /b 0

rem --- Plan B: no separate environment possible - install the libraries for this Python itself
:novenv
echo.
echo  Could not create a separate environment - using your Python directly instead.
:system
%PY% -c "import flask, PIL, numpy, imageio_ffmpeg, requests" >nul 2>nul && goto :runsys
echo.
echo  Downloading the libraries CropKit needs - flask, pillow, numpy, ffmpeg. Progress below:
echo.
%PY% -m pip install --user --disable-pip-version-check --timeout 60 -r requirements.txt || goto :pipfail
:runsys
echo used> "%SYSMARK%"
echo.
echo  Starting CropKit... You can minimise this window. Closing it stops CropKit.
%PY% app.py %*
pause
exit /b 0

:inzip
echo.
echo  CropKit is still inside the downloaded .zip file.
echo  Close this window, right-click the .zip, choose "Extract All...", open the extracted
echo  CropKit folder and double-click start.bat there.
echo  Tip: extract it to a normal folder such as C:\Users\%USERNAME%\CropKit, not into OneDrive.
echo.
pause
exit /b 1

:nopython
echo.
echo  Python 3 is not installed. Install it from https://www.python.org/downloads/
echo  and tick "Add python.exe to PATH" during the installation. Then start again.
echo.
pause
exit /b 1

:pipfail
echo.
echo  The libraries could not be downloaded - see the message above.
echo  Check the internet connection - or a company proxy/VPN - and start again.
echo.
pause
exit /b 1
