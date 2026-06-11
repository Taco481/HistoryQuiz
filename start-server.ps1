$port = 8080
$prefix = "http://localhost:$port/"

# URL ACL registreren (nodig voor HttpListener zonder admin rechten)
$aclCmd = 'netsh http add urlacl url=' + $prefix + ' user="NT AUTHORITY\Authenticated Users" listen=yes'
Invoke-Expression $aclCmd 2>$null | Out-Null

Write-Host "History Quiz - Lokale server starten..." -ForegroundColor Green
Write-Host "Open http://localhost:$port in je browser" -ForegroundColor Cyan
Write-Host "Druk op Ctrl+C om te stoppen" -ForegroundColor Yellow

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $path = $request.Url.LocalPath.TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }

    $fullPath = Join-Path -Path $PSScriptRoot -ChildPath $path

    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        $content = [System.IO.File]::ReadAllBytes($fullPath)

        $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
        $mime = switch ($ext) {
            '.html' { 'text/html; charset=utf-8' }
            '.css'  { 'text/css; charset=utf-8' }
            '.js'   { 'application/javascript; charset=utf-8' }
            '.json' { 'application/json; charset=utf-8' }
            '.png'  { 'image/png' }
            '.jpg'  { 'image/jpeg' }
            '.svg'  { 'image/svg+xml' }
            default { 'application/octet-stream' }
        }

        $response.ContentType = $mime
        $response.StatusCode = 200
        $response.OutputStream.Write($content, 0, $content.Length)
    } else {
        $errorMsg = [System.Text.Encoding]::UTF8.GetBytes("404 - $path niet gevonden")
        $response.StatusCode = 404
        $response.OutputStream.Write($errorMsg, 0, $errorMsg.Length)
    }

    $response.Close()
}

$listener.Stop()
