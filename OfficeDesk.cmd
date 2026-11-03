@echo off
rem Chay Office Desk tu ma nguon trong thu muc repo (giong npm start), khong can build ban cai.
set "APP=%~dp0"
set "ELECTRON=%APP%node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" (
  echo Thieu Electron: chay "npm install" trong %APP% roi thu lai.
  pause
  exit /b 1
)
rem Ban cai dung chung du lieu va khoa mot cua so: dang mo thi ban repo chi dua cua so ban cai len roi thoat.
tasklist /fi "imagename eq Office Desk.exe" | find /i "Office Desk.exe" >nul && (
  echo Ban cai Office Desk dang chay. Dong no ^(ca icon o khay he thong^) roi chay lai file nay.
  pause
  exit /b 1
)
start "" "%ELECTRON%" "%APP%."
