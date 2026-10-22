@echo off
rem Starts the Apply Desk helper from this folder. A shortcut to this file in your Windows Startup folder
rem (Win+R, shell:startup) starts the helper whenever you sign in to Windows.
title Apply Desk helper
cd /d "%~dp0"
call npm start
