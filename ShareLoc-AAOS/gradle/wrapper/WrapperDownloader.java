import java.io.InputStream;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;

public final class WrapperDownloader {
    private static final String URL = "https://services.gradle.org/distributions/gradle-8.11.1-wrapper.jar";
    private static final String SHA256 = "2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046";

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Target path required");
        Path target = Path.of(args[0]);
        Files.createDirectories(target.getParent());
        Path temp = target.resolveSibling(target.getFileName() + ".tmp");
        System.out.println("Downloading Gradle wrapper...");
        try (InputStream input = URI.create(URL).toURL().openStream()) {
            Files.copy(input, temp, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        String actual = HexFormat.of().formatHex(digest.digest(Files.readAllBytes(temp)));
        if (!SHA256.equalsIgnoreCase(actual)) {
            Files.deleteIfExists(temp);
            throw new SecurityException("Unexpected Gradle wrapper checksum: " + actual);
        }
        Files.move(temp, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        System.out.println("Gradle wrapper ready: " + target);
    }
}
