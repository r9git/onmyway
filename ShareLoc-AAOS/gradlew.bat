@rem Gradle wrapper start script for Windows
@echo off
setlocal
set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.
set APP_HOME=%DIRNAME%
set CLASSPATH=%APP_HOME%\gradle\wrapper\gradle-wrapper.jar
if defined JAVA_HOME goto findJavaFromJavaHome
set JAVA_EXE=java.exe
%JAVA_EXE% -version >NUL 2>&1
if %ERRORLEVEL% equ 0 goto ensureWrapper
echo ERROR: JAVA_HOME is not set and no 'java' command could be found.
exit /b 1
:findJavaFromJavaHome
set JAVA_HOME=%JAVA_HOME:"=%
set JAVA_EXE=%JAVA_HOME%\bin\java.exe
if not exist "%JAVA_EXE%" (
  echo ERROR: JAVA_HOME is set to an invalid directory: %JAVA_HOME%
  exit /b 1
)
:ensureWrapper
if exist "%CLASSPATH%" goto execute
"%JAVA_EXE%" "%APP_HOME%\gradle\wrapper\WrapperDownloader.java" "%CLASSPATH%"
if not %ERRORLEVEL% equ 0 exit /b %ERRORLEVEL%
:execute
"%JAVA_EXE%" -Dorg.gradle.appname=gradlew -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
endlocal
