@echo off
REM Creates the project virtual environment (.venv) on Windows and installs requirements.
REM Run from the repo root:  setup\setup_env.bat  (or double-click it).
cd /d "%~dp0.."
python -m venv .venv || (echo Python not found - install Python 3.10-3.12 from python.org & pause & exit /b 1)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r setup\requirements.txt
python -m ipykernel install --user --name dsa4262 --display-name "Python (DSA4262)"
echo.
echo Done. Activate later with:  .venv\Scripts\activate
echo In Jupyter / VS Code choose the kernel "Python (DSA4262)".
pause
