# ==========================================================================
#  PinGrab - generates PWA icons, favicons, OG image and store screenshot.
#  Requires Windows PowerShell 5.1+ (uses System.Drawing, no downloads).
#
#  Run:  powershell -NoProfile -ExecutionPolicy Bypass -File make-assets.ps1
# ==========================================================================
Add-Type -AssemblyName System.Drawing

$root = $PSScriptRoot
$iconDir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

$accent1 = [System.Drawing.Color]::FromArgb(255, 255, 51, 75)   # #ff334b
$accent2 = [System.Drawing.Color]::FromArgb(255, 212, 0, 31)    # #d4001f
$ink     = [System.Drawing.Color]::FromArgb(255, 26, 17, 20)    # near-black warm
$muted   = [System.Drawing.Color]::FromArgb(255, 122, 106, 112)
$paper   = [System.Drawing.Color]::FromArgb(255, 255, 250, 248) # #fffaf8

function New-RoundedPath {
    param([System.Drawing.RectangleF]$Rect, [float]$Radius)
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($Radius -le 0) {
        $p.AddRectangle($Rect)
        return $p
    }
    $d = [math]::Min($Radius * 2, [math]::Min($Rect.Width, $Rect.Height))
    $p.AddArc($Rect.X, $Rect.Y, $d, $d, 180, 90)
    $p.AddArc($Rect.X + $Rect.Width - $d, $Rect.Y, $d, $d, 270, 90)
    $p.AddArc($Rect.X + $Rect.Width - $d, $Rect.Y + $Rect.Height - $d, $d, $d, 0, 90)
    $p.AddArc($Rect.X, $Rect.Y + $Rect.Height - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

# Draws the pin + download-arrow mark inside a square of $Size pixels.
function Add-PinGlyph {
    param([System.Drawing.Graphics]$G, [int]$Size, [float]$Factor)

    $u = $Size / 64.0
    $cx = $Size / 2.0
    $cy = $Size / 2.0
    $s = $u * $Factor
    # viewBox centre of the glyph is roughly (32, 31.5)
    $X = { param($v) [float]($cx + ($v - 32) * $s) }
    $Y = { param($v) [float]($cy + ($v - 31.5) * $s) }

    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

    # head of the pin
    $r = [float](14.5 * $s)
    $gx = [float]($cx - $r)
    $gy = [float]($cy - 5.5 * $s - $r)
    $G.FillEllipse($white, $gx, $gy, ($r * 2), ($r * 2))

    # tail of the pin (rounded triangle)
    $tail = @(
        (New-Object System.Drawing.PointF((& $X 20.5), (& $Y 35.5))),
        (New-Object System.Drawing.PointF((& $X 43.5), (& $Y 35.5))),
        (New-Object System.Drawing.PointF((& $X 32),   (& $Y 51)))
    )
    $G.FillPolygon($white, $tail)

    # download arrow, cut out of the white shape using the brand gradient
    $rect = New-Object System.Drawing.RectangleF((& $X 29.4), (& $Y 16.5), (5.2 * $s), (12.8 * $s))
    $shaft = New-RoundedPath -Rect $rect -Radius ([float](2.6 * $s))
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $accent1, $accent2, 90)
    $G.FillPath($brush, $shaft)

    $head = @(
        (New-Object System.Drawing.PointF((& $X 24.1), (& $Y 28.3))),
        (New-Object System.Drawing.PointF((& $X 39.9), (& $Y 28.3))),
        (New-Object System.Drawing.PointF((& $X 32),   (& $Y 37.6)))
    )
    $G.FillPolygon($brush, $head)

    $brush.Dispose(); $shaft.Dispose(); $white.Dispose()
}

function New-IconBitmap {
    param([int]$Size, [bool]$Maskable = $false)
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.PixelOffsetMode = 'HighQuality'
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = $(if ($Maskable) { 0.0 } else { $Size * 0.045 })
    $rect = New-Object System.Drawing.RectangleF($pad, $pad, ($Size - 2 * $pad), ($Size - 2 * $pad))
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $accent1, $accent2, 45)
    $radius = $(if ($Maskable) { 0.0 } else { $Size * 0.235 })
    $path = New-RoundedPath -Rect $rect -Radius $radius
    $g.FillPath($bgBrush, $path)
    $path.Dispose()

    # Maskable icons need the glyph inside the 80% safe circle
    $factor = $(if ($Maskable) { 0.74 } else { 1.0 })
    Add-PinGlyph -G $g -Size $Size -Factor $factor

    $bgBrush.Dispose(); $g.Dispose()
    return $bmp
}

function Save-Icon {
    param([int]$Size, [string]$Name, [bool]$Maskable = $false)
    $bmp = New-IconBitmap -Size $Size -Maskable $Maskable
    $bmp.Save((Join-Path $iconDir $Name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "  $Name ($Size px)"
}

Write-Host 'Icons:'
Save-Icon -Size 192 -Name 'icon-192.png'
Save-Icon -Size 512 -Name 'icon-512.png'
Save-Icon -Size 512 -Name 'icon-maskable-512.png' -Maskable $true
Save-Icon -Size 180 -Name 'apple-touch-icon.png'
Save-Icon -Size 32 -Name 'favicon-32.png'
Save-Icon -Size 16 -Name 'favicon-16.png'

# ---------- favicon.ico (multi-size, PNG payloads) ----------
$sizes = @(16, 24, 32, 48, 64)
$pngData = @()
foreach ($size in $sizes) {
    $bmp = New-IconBitmap -Size $size
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngData += , @($size, $ms.ToArray())
    $bmp.Dispose(); $ms.Dispose()
}
$outMs = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($outMs)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$pngData.Count)
$offset = 6 + 16 * $pngData.Count
foreach ($entry in $pngData) {
    $dim = $(if ($entry[0] -ge 256) { [byte]0 } else { [byte]$entry[0] })
    $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32)
    $bw.Write([uint32]$entry[1].Length); $bw.Write([uint32]$offset)
    $offset += $entry[1].Length
}
foreach ($entry in $pngData) { $bw.Write($entry[1]) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $iconDir 'favicon.ico'), $outMs.ToArray())
$bw.Dispose(); $outMs.Dispose()
Write-Host '  favicon.ico (16, 24, 32, 48, 64)'

# ---------- OG image 1200x630 ----------
$ow = 1200; $oh = 630
$og = New-Object System.Drawing.Bitmap($ow, $oh)
$g = [System.Drawing.Graphics]::FromImage($og)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'

$rect = New-Object System.Drawing.RectangleF(0, 0, $ow, $oh)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
    [System.Drawing.Color]::FromArgb(255, 24, 13, 17), [System.Drawing.Color]::FromArgb(255, 62, 12, 25), 35)
$g.FillRectangle($bg, $rect)

$glow1 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 230, 0, 35))
$glow2 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(45, 255, 122, 89))
$g.FillEllipse($glow1, -200, -240, 720, 720)
$g.FillEllipse($glow2, 820, 300, 620, 620)

$mark = New-IconBitmap -Size 128
$g.DrawImage($mark, 82, 88, 128, 128)
$mark.Dispose()

$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$soft  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 226, 208, 212))
$dim   = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 190, 166, 172))
$fTitle = New-Object System.Drawing.Font('Segoe UI', 66, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fSub   = New-Object System.Drawing.Font('Segoe UI', 29, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fChip  = New-Object System.Drawing.Font('Segoe UI', 22, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

$g.DrawString('PinGrab', $fTitle, $white, 236, 100)
$g.DrawString('Pinterest video downloader', $fSub, $soft, 240, 180)
$g.DrawString('Paste a Pinterest link and save the video in HD.', $fSub, $dim, 84, 300)

$chips = @('HD 720p / 1080p', 'No watermark', 'No sign-up', 'Free')
$x = 84
foreach ($chip in $chips) {
    $sz = $g.MeasureString($chip, $fChip)
    $cw = $sz.Width + 44
    $chipRect = New-Object System.Drawing.RectangleF($x, 370, $cw, 56)
    $chipPath = New-RoundedPath -Rect $chipRect -Radius 28
    $chipBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(38, 255, 255, 255))
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(55, 255, 255, 255), 1.5)
    $g.FillPath($chipBrush, $chipPath)
    $g.DrawPath($pen, $chipPath)
    $g.DrawString($chip, $fChip, $white, ($x + 22), 383)
    $chipBrush.Dispose(); $pen.Dispose(); $chipPath.Dispose()
    $x += $cw + 16
}
$g.DrawString('pingrab.opterik.com', $fChip, $dim, 84, 490)

$og.Save((Join-Path $iconDir 'og-image.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $og.Dispose()
Write-Host '  og-image.png (1200x630)'

# ---------- PWA screenshot 1280x720 (stylised UI mock) ----------
$sw = 1280; $sh = 720
$shot = New-Object System.Drawing.Bitmap($sw, $sh)
$g = [System.Drawing.Graphics]::FromImage($shot)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'

$g.Clear($paper)
$bgRect = New-Object System.Drawing.RectangleF(0, 0, $sw, $sh)
$warm = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect,
    [System.Drawing.Color]::FromArgb(255, 255, 250, 248), [System.Drawing.Color]::FromArgb(255, 255, 238, 240), 90)
$g.FillRectangle($warm, $bgRect)

# header
$headerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 240, 226, 227), 1)
$g.DrawLine($headerPen, 0, 72, $sw, 72)
$mark = New-IconBitmap -Size 40
$g.DrawImage($mark, 56, 16, 40, 40)
$mark.Dispose()

$fLogo = New-Object System.Drawing.Font('Segoe UI', 24, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fNav  = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fHero = New-Object System.Drawing.Font('Segoe UI', 54, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fLead = New-Object System.Drawing.Font('Segoe UI', 21, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fSmall = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fBtn  = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fLbl  = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

$darkText = New-Object System.Drawing.SolidBrush($ink)
$mutedText = New-Object System.Drawing.SolidBrush($muted)
$redBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 230, 0, 35))
$g.DrawString('PinGrab', $fLogo, $darkText, 106, 24)

$x = 530
foreach ($item in @('Downloader', 'How it works', 'FAQ')) {
    $g.DrawString($item, $fNav, $mutedText, $x, 32)
    $x += 120
}
$pill = New-Object System.Drawing.RectangleF(1000, 20, 120, 34)
$pillPath = New-RoundedPath -Rect $pill -Radius 17
$g.FillPath($redBrush, $pillPath)
$g.DrawString('Install', $fLbl, [System.Drawing.Brushes]::White, 1032, 28)
$pillPath.Dispose()

# hero copy
$fEyebrow = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('FREE  ·  NO WATERMARK  ·  NO SIGN-UP', $fEyebrow, $redBrush, 56, 116)
$g.DrawString('Pinterest videos,', $fHero, $darkText, 54, 148)
$g.DrawString('saved in HD.', $fHero, $darkText, 54, 210)
$g.DrawString('Paste a pin link. PinGrab finds the original MP4,', $fLead, $mutedText, 56, 296)
$g.DrawString('shows you a preview and downloads it to your device.', $fLead, $mutedText, 56, 326)

# downloader card
$card = New-Object System.Drawing.RectangleF(56, 386, 760, 214)
$cardPath = New-RoundedPath -Rect $card -Radius 22
$cardBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$cardPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 238, 220, 222), 1.2)
$g.FillPath($cardBg, $cardPath)
$g.DrawPath($cardPen, $cardPath)
$g.DrawString('PASTE A PINTEREST LINK', $fLbl, $mutedText, 80, 408)

$field = New-Object System.Drawing.RectangleF(80, 430, 500, 56)
$fieldPath = New-RoundedPath -Rect $field -Radius 12
$fieldBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 247, 246))
$fieldPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 232, 214, 216), 1)
$g.FillPath($fieldBg, $fieldPath)
$g.DrawPath($fieldPen, $fieldPath)
$g.DrawString('https://www.pinterest.com/pin/361554676351203398/', $fSmall, $mutedText, 98, 449)

$btn = New-Object System.Drawing.RectangleF(594, 430, 202, 56)
$btnPath = New-RoundedPath -Rect $btn -Radius 12
$g.FillPath($redBrush, $btnPath)
$g.DrawString('Get video', $fBtn, [System.Drawing.Brushes]::White, 646, 444)
$btnPath.Dispose(); $fieldPath.Dispose(); $fieldBg.Dispose(); $fieldPen.Dispose(); $cardPen.Dispose(); $cardBg.Dispose(); $cardPath.Dispose()

$g.DrawString('Works with pinterest.com/pin/… and pin.it/… links', $fSmall, $mutedText, 82, 508)
$g.DrawString('v 1.2.3', $fSmall, $mutedText, 736, 508)

# right preview card
$prev = New-Object System.Drawing.RectangleF(856, 140, 368, 460)
$prevPath = New-RoundedPath -Rect $prev -Radius 22
$prevBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$prevPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 238, 220, 222), 1.2)
$g.FillPath($prevBg, $prevPath)
$g.DrawPath($prevPen, $prevPath)

$thumb = New-Object System.Drawing.RectangleF(876, 160, 328, 250)
$thumbPath = New-RoundedPath -Rect $thumb -Radius 16
$thumbBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($thumb,
    [System.Drawing.Color]::FromArgb(255, 255, 122, 89), [System.Drawing.Color]::FromArgb(255, 196, 20, 46), 55)
$g.FillPath($thumbBrush, $thumbPath)

# play button
$play = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 255, 255, 255))
$g.FillEllipse($play, 990, 250, 76, 76)
$tri = @(
    (New-Object System.Drawing.PointF(1020, 272)),
    (New-Object System.Drawing.PointF(1020, 304)),
    (New-Object System.Drawing.PointF(1046, 288))
)
$g.FillPolygon($redBrush, $tri)

$g.DrawString('Pinterest video', $fBtn, $darkText, 878, 430)
$g.DrawString('1080p  ·  MP4  ·  12.4 MB', $fSmall, $mutedText, 878, 462)
$dl = New-Object System.Drawing.RectangleF(876, 496, 328, 54)
$dlPath = New-RoundedPath -Rect $dl -Radius 12
$g.FillPath($redBrush, $dlPath)
$g.DrawString('Download MP4', $fBtn, [System.Drawing.Brushes]::White, 968, 510)
$dlPath.Dispose()

$g.DrawString('Preview and quality options before you save', $fSmall, $mutedText, 878, 566)

$shot.Save((Join-Path $iconDir 'screenshot-wide.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $shot.Dispose()
Write-Host '  screenshot-wide.png (1280x720)'

# dispose shared objects
$white.Dispose(); $soft.Dispose(); $dim.Dispose()
$darkText.Dispose(); $mutedText.Dispose(); $redBrush.Dispose()
$headerPen.Dispose(); $warm.Dispose()
$fLogo.Dispose(); $fNav.Dispose(); $fHero.Dispose(); $fLead.Dispose(); $fSmall.Dispose(); $fBtn.Dispose(); $fLbl.Dispose(); $fEyebrow.Dispose()
$fTitle.Dispose(); $fSub.Dispose(); $fChip.Dispose()
$bg.Dispose(); $glow1.Dispose(); $glow2.Dispose()
$play.Dispose(); $thumbBrush.Dispose(); $thumbPath.Dispose(); $prevBg.Dispose(); $prevPen.Dispose(); $prevPath.Dispose()

Write-Host 'Done. Assets written to icons/'
