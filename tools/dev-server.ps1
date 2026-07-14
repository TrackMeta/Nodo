# Servidor estático de desarrollo (sin dependencias: PowerShell + HttpListener).
# Uso: powershell -ExecutionPolicy Bypass -File tools\dev-server.ps1 [-Port 8123]
# Sirve la raíz del repo en http://127.0.0.1:<Port>/ (p.ej. /panel/canvas-demo.html)
param([int]$Port = 8123)

$root = Split-Path -Parent $PSScriptRoot   # raíz del repo (padre de tools\)
$mime = @{
  ".html"="text/html; charset=utf-8"; ".css"="text/css; charset=utf-8"
  ".js"="text/javascript; charset=utf-8"; ".mjs"="text/javascript; charset=utf-8"
  ".json"="application/json; charset=utf-8"; ".svg"="image/svg+xml"
  ".png"="image/png"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"; ".gif"="image/gif"
  ".ico"="image/x-icon"; ".woff"="font/woff"; ".woff2"="font/woff2"; ".txt"="text/plain; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Sirviendo $root en http://127.0.0.1:$Port/"

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $res = $ctx.Response
  try {
    # POST /__snapshot?name=x : guarda el body (base64 de imagen) como archivo
    # en tools\snapshots\ — lo usa Claude para capturar el lienzo en desarrollo.
    if ($ctx.Request.HttpMethod -eq "POST" -and $ctx.Request.Url.AbsolutePath -eq "/__snapshot") {
      $name = $ctx.Request.QueryString["name"]; if (-not $name) { $name = "snap" }
      $name = $name -replace "[^a-zA-Z0-9_-]", ""
      $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream, $ctx.Request.ContentEncoding)
      $b64 = $reader.ReadToEnd(); $reader.Close()
      $dir = Join-Path $root "tools\snapshots"
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
      $file = Join-Path $dir "$name.jpg"
      [System.IO.File]::WriteAllBytes($file, [Convert]::FromBase64String($b64))
      $res.StatusCode = 200
      $body = [Text.Encoding]::UTF8.GetBytes("guardado: $file")
      $res.OutputStream.Write($body, 0, $body.Length)
      $res.OutputStream.Close()
      continue
    }
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart("/")
    if ($rel -eq "") { $rel = "index.html" }
    $path = Join-Path $root ($rel -replace "/", "\")
    # No salir de la raíz del repo
    $full = [System.IO.Path]::GetFullPath($path)
    if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
      $res.StatusCode = 404
      $body = [Text.Encoding]::UTF8.GetBytes("404 - no encontrado: /$rel")
      $res.OutputStream.Write($body, 0, $body.Length)
    } else {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
      $res.Headers.Add("Cache-Control","no-store")
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
    try { $res.StatusCode = 500 } catch {}
  } finally {
    try { $res.OutputStream.Close() } catch {}
  }
}
