param(
  [Parameter(Mandatory = $true)][string]$ProfilePath,
  [Parameter(Mandatory = $true)][string]$ExtensionPath
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

<#
========================================================================
步骤1：核对独立配置与生产构建
========================================================================
数据源：测试驱动参数、系统临时目录与当前工作树 dist。
操作：1) 只接受本任务临时配置。2) 副本文件清单及摘要必须与 dist 完全一致。
#>
Write-Output '开始核对备份测试加载路径'
try {
  # 1.1 配置必须为系统临时目录的直属 algorhythm-backup-* 目录。
  $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $testProfile = (Resolve-Path -LiteralPath $ProfilePath).Path.TrimEnd('\')
  if ((Split-Path -Parent $testProfile) -ne $temporaryRoot -or (Split-Path -Leaf $testProfile) -notlike 'algorhythm-backup-*') {
    throw 'Only an isolated backup test profile is allowed.'
  }
  # 1.2 仅允许当前构建或本任务临时目录中的生产构建副本。
  $productionBuild = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../dist')).Path.TrimEnd('\')
  $targetBuild = (Resolve-Path -LiteralPath $ExtensionPath).Path.TrimEnd('\')
  if ($targetBuild -ne $productionBuild) {
    $relativeBuild = [IO.Path]::GetRelativePath($temporaryRoot, $targetBuild)
    if ([IO.Path]::IsPathRooted($relativeBuild) -or $relativeBuild.StartsWith('..') -or ($relativeBuild -split '[\\/]')[0] -notlike 'algorhythm-backup-*') {
      throw 'Extension copy must stay inside this task temporary directory.'
    }
  }
  $manifest = Get-Content -LiteralPath (Join-Path $targetBuild 'manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.name -ne 'AlgoRhythm · 存储原型' -or $manifest.manifest_version -ne 3) { throw 'Unexpected extension manifest.' }
  # 1.3 拒绝增添测试入口、权限或其他文件的副本。
  $productionFiles = @(Get-ChildItem -LiteralPath $productionBuild -Recurse -File | ForEach-Object { [IO.Path]::GetRelativePath($productionBuild, $_.FullName) } | Sort-Object)
  $targetFiles = @(Get-ChildItem -LiteralPath $targetBuild -Recurse -File | ForEach-Object { [IO.Path]::GetRelativePath($targetBuild, $_.FullName) } | Sort-Object)
  if (Compare-Object $productionFiles $targetFiles) { throw 'Extension file list differs from production build.' }
  foreach ($relativeFile in $productionFiles) {
    $productionHash = (Get-FileHash -LiteralPath (Join-Path $productionBuild $relativeFile) -Algorithm SHA256).Hash
    $targetHash = (Get-FileHash -LiteralPath (Join-Path $targetBuild $relativeFile) -Algorithm SHA256).Hash
    if ($productionHash -ne $targetHash) { throw 'Extension file content differs from production build.' }
  }
} finally { Write-Output '备份测试加载路径核对结束' }

<#
========================================================================
步骤2：只操作对应 Chrome 的官方目录选择器
========================================================================
数据源：带完整独立配置参数的 Chrome 进程与 Windows UI Automation。
操作：1) 排除个人窗口和不唯一控件。2) 填入已核对路径，调用官方选择按钮。
#>
Write-Output '开始选择测试扩展目录'
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  # 2.1 进程参数必须完整匹配当前配置，不能只匹配相似目录名。
  $profileArgument = '--user-data-dir=(?:"{0}"|{0}(?=\s|$|"))' -f [regex]::Escape($testProfile)
  $testProcessIds = @((Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -match $profileArgument }).ProcessId)
  if ($testProcessIds.Count -eq 0) { throw 'Isolated test Chrome process missing.' }
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  $chosen = $null
  do {
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $candidates = @()
    foreach ($testWindow in $windows) {
      if ($testProcessIds -notcontains $testWindow.Current.ProcessId) { continue }
      # 2.2 原生选择器可能嵌在测试窗口内，故检查整个所属窗口的后代。
      $controls = $testWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      $folderInputs = @($controls | Where-Object { $_.Current.AutomationId -eq '1152' -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit })
      $selectButtons = @($controls | Where-Object { $_.Current.Name -in @('选择文件夹', 'Select Folder') -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button })
      if ($folderInputs.Count -eq 0 -and $selectButtons.Count -eq 0) { continue }
      if ($folderInputs.Count -ne 1 -or $selectButtons.Count -ne 1) { throw 'Test chooser controls are not unique.' }
      $candidates += [pscustomobject]@{ Input = $folderInputs[0]; Button = $selectButtons[0] }
    }
    if ($candidates.Count -gt 1) { throw 'Multiple test chooser windows found.' }
    if ($candidates.Count -eq 1) { $chosen = $candidates[0]; break }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($null -eq $chosen) {
    # 2.3 失败诊断只列出已匹配测试窗口的按钮/输入框元数据，不读取控件值。
    $probeWindows = @()
    foreach ($testWindow in $windows) {
      if ($testProcessIds -notcontains $testWindow.Current.ProcessId) { continue }
      $probeControls = $testWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      $probeWindows += [pscustomobject]@{
        ProcessId = $testWindow.Current.ProcessId
        WindowName = $testWindow.Current.Name
        Controls = @($probeControls | Where-Object { $_.Current.ControlType -in @([System.Windows.Automation.ControlType]::Edit, [System.Windows.Automation.ControlType]::Button, [System.Windows.Automation.ControlType]::ComboBox) } | Select-Object -First 100 | ForEach-Object { [pscustomobject]@{ Name = $_.Current.Name; AutomationId = $_.Current.AutomationId; ControlType = $_.Current.ControlType.ProgrammaticName } })
      }
    }
    Write-Output ($probeWindows | ConvertTo-Json -Depth 5 -Compress)
    throw 'Official isolated test chooser missing.'
  }
  # 2.4 不发送系统快捷键或改焦点，仅调用已定位控件的受支持模式。
  ([System.Windows.Automation.ValuePattern]$chosen.Input.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($targetBuild)
  ([System.Windows.Automation.InvokePattern]$chosen.Button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
  Write-Output '已在测试 Chrome 官方选择器加载生产构建'
} finally { Write-Output '测试扩展目录选择结束' }
