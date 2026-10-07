# Генератор иконок приложения «Хранилище» (запускать один раз)
Add-Type -AssemblyName System.Drawing

function RoundedRectPath($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
  $p.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
  $p.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-Icon([int]$size, [string]$outPath, [bool]$maskable) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $blue = [System.Drawing.Color]::FromArgb(37, 99, 235)
  $brushBlue = New-Object System.Drawing.SolidBrush($blue)

  if ($maskable) {
    $g.FillRectangle($brushBlue, 0, 0, $size, $size)
  } else {
    $path = RoundedRectPath 0 0 ($size - 1) ($size - 1) ($size * 0.22)
    $g.FillPath($brushBlue, $path)
    $path.Dispose()
  }

  # Глиф «база данных»: белый цилиндр с синими разделителями
  $padFactor = 0.26
  if ($maskable) { $padFactor = 0.30 }
  $w = $size * (1 - 2 * $padFactor)
  $h = $size * 0.46
  $x = $size * $padFactor
  $top = ($size - $h) / 2
  $ellH = $w * 0.30

  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillEllipse($white, $x, $top, $w, $ellH)
  $g.FillRectangle($white, $x, ($top + $ellH / 2), $w, ($h - $ellH))
  $g.FillEllipse($white, $x, ($top + $h - $ellH), $w, $ellH)

  $penWidth = [Math]::Max(2, $size * 0.018)
  $pen = New-Object System.Drawing.Pen($blue, $penWidth)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $y1 = $top + $ellH + ($h - $ellH) / 3
  $y2 = $top + $ellH + 2 * ($h - $ellH) / 3
  $inset = $w * 0.05
  $g.DrawLine($pen, ($x + $inset), $y1, ($x + $w - $inset), $y1)
  $g.DrawLine($pen, ($x + $inset), $y2, ($x + $w - $inset), $y2)

  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose(); $white.Dispose(); $brushBlue.Dispose()
  $g.Dispose(); $bmp.Dispose()
  Write-Host "OK: $outPath"
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Icon 192 (Join-Path $dir 'icon-192.png') $false
New-Icon 512 (Join-Path $dir 'icon-512.png') $false
New-Icon 512 (Join-Path $dir 'icon-512-maskable.png') $true
