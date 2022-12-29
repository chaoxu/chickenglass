import Development.Shake
import Development.Shake.Command
import Development.Shake.FilePath
import Development.Shake.Util

src = "example"
dest = "_build"

main :: IO ()
main = shakeArgs shakeOptions{shakeFiles=dest} $ do
    want [ dest </> "example.html"]

    phony "clean" $ do
        putInfo "Cleaning files in _build"
        removeFilesAfter dest ["//*"]

    "_build/*.html"  %> \out -> do
        files <- getDirectoryFiles src ["//*"]
        need [src </> c | c <- files]
        cmd_ "./chickenglass.py" src dest

