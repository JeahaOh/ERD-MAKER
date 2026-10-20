import java.net.*;
import java.nio.file.*;
import java.util.*;
/** Isolated URL loader retains the vendor's supported standalone resource lookup on JDK 21. */
public final class OracleBootstrap {
 public static void main(String[] args) throws Exception {
  var urls = new ArrayList<URL>();
  urls.add(Path.of(".analysis/oracle/classes").toUri().toURL());
  for(String jar:System.getenv().getOrDefault("ORACLE_JARS", "").split(java.io.File.pathSeparator)) if(!jar.isEmpty()) urls.add(Path.of(jar).toUri().toURL());
  for (String dir : List.of(System.getenv().getOrDefault("ECLIPSE_PLUGINS", "/Applications/DBeaver.app/Contents/Eclipse/plugins"))) {
   try (var files = Files.list(Path.of(dir))) {
    files.filter(p -> p.toString().endsWith(".jar")).sorted().forEach(p -> { try { urls.add(p.toUri().toURL()); } catch(Exception e) { throw new RuntimeException(e); } });
   }
  }
  try(var loader = new URLClassLoader(urls.toArray(URL[]::new), ClassLoader.getPlatformClassLoader())) {
   Thread.currentThread().setContextClassLoader(loader);
   try { loader.loadClass(System.getenv().getOrDefault("ORACLE_MAIN_CLASS", "OriginalExerdOracle")).getMethod("main", String[].class).invoke(null, (Object)args); }
   catch(java.lang.reflect.InvocationTargetException e) { e.getCause().printStackTrace(); System.exit(1); }
  }
 }
}
