param(
	[Parameter(Mandatory = $true)]
	[string]$InputVsix,

	[Parameter(Mandatory = $true)]
	[string]$OutputVsix,

	[string]$VsCodeEngine = "^1.1.1"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$inputPath = (Resolve-Path -LiteralPath $InputVsix).Path
$outputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputVsix)
$outputDir = Split-Path -Parent $outputPath
if ($outputDir -and -not (Test-Path -LiteralPath $outputDir)) {
	New-Item -ItemType Directory -Path $outputDir | Out-Null
}

Copy-Item -LiteralPath $inputPath -Destination $outputPath -Force

$archive = [System.IO.Compression.ZipFile]::Open($outputPath, [System.IO.Compression.ZipArchiveMode]::Update)
try {
	$packageEntry = $archive.GetEntry("extension/package.json")
	if ($null -eq $packageEntry) {
		throw "extension/package.json not found in VSIX."
	}

	$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
	$reader = [System.IO.StreamReader]::new($packageEntry.Open(), $utf8NoBom)
	try {
		$packageJson = $reader.ReadToEnd()
	} finally {
		$reader.Dispose()
	}

	$package = $packageJson | ConvertFrom-Json
	$package.engines.vscode = $VsCodeEngine
	$updatedPackageJson = ($package | ConvertTo-Json -Depth 100)
	$packageEntry.Delete()
	$packageEntry = $archive.CreateEntry("extension/package.json")
	$writer = [System.IO.StreamWriter]::new($packageEntry.Open(), $utf8NoBom)
	try {
		$writer.Write($updatedPackageJson)
	} finally {
		$writer.Dispose()
	}

	$manifestEntry = $archive.GetEntry("extension.vsixmanifest")
	if ($null -eq $manifestEntry) {
		throw "extension.vsixmanifest not found in VSIX."
	}

	$reader = [System.IO.StreamReader]::new($manifestEntry.Open(), $utf8NoBom)
	try {
		$manifest = $reader.ReadToEnd()
	} finally {
		$reader.Dispose()
	}

	$updatedManifest = $manifest -replace '(<Property Id="Microsoft\.VisualStudio\.Code\.Engine" Value=")[^"]+(" />)', "`${1}$VsCodeEngine`${2}"
	if ($updatedManifest -eq $manifest) {
		throw "VS Code engine property was not found in extension.vsixmanifest."
	}

	$manifestEntry.Delete()
	$manifestEntry = $archive.CreateEntry("extension.vsixmanifest")
	$writer = [System.IO.StreamWriter]::new($manifestEntry.Open(), $utf8NoBom)
	try {
		$writer.Write($updatedManifest)
	} finally {
		$writer.Dispose()
	}
} finally {
	$archive.Dispose()
}

Write-Output "Patched VSIX engine to ${VsCodeEngine}: $OutputVsix"
