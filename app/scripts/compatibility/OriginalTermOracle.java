import java.nio.file.*;
import java.util.*;
import org.eclipse.emf.common.util.URI;
import org.eclipse.emf.ecore.*;
import org.eclipse.emf.ecore.util.EcoreUtil;
import org.eclipse.emf.ecore.xmi.impl.XMLResourceImpl;
import com.tomato.exerd.term.model.TermModelPackage;

/** Original generated term package/factory, using the XMLResourceImpl used by FileDocument. No UI or licensing modification. */
public final class OriginalTermOracle {
  public static void main(String[] args) throws Exception {
    EPackage.Registry.INSTANCE.put(TermModelPackage.eNS_URI,TermModelPackage.eINSTANCE);
    var resource = new XMLResourceImpl(URI.createFileURI(Path.of(args[0]).toAbsolutePath().toString()));
    resource.load(Map.of());
    if(!resource.getErrors().isEmpty()) throw new IllegalStateException("Original term metamodel reported errors: "+resource.getErrors());
    var counts = new TreeMap<String,Integer>();
    for(var root:resource.getContents()){ counts.merge(root.eClass().getName(),1,Integer::sum);root.eAllContents().forEachRemaining(o->counts.merge(o.eClass().getName(),1,Integer::sum)); }
    if(resource.getContents().size()!=1 || !resource.getContents().get(0).eClass().getName().equals("TermDictionary")) throw new IllegalArgumentException("Not a TermDictionary");
    var unresolved=EcoreUtil.UnresolvedProxyCrossReferencer.find(resource);
    if(!unresolved.isEmpty())throw new IllegalStateException("Unresolved term references: "+unresolved.size());
    OriginalExerdOracle.dumpGraph(resource,args[0]);
    if(args.length>1)try(var out=Files.newOutputStream(Path.of(args[1]),StandardOpenOption.CREATE_NEW)){resource.save(out,Map.of());}
    var countFields=new ArrayList<String>();for(var entry:counts.entrySet())countFields.add(OriginalExerdOracle.q(entry.getKey())+":"+entry.getValue());
    System.out.println("{\"reader\":\"EMF XMLResourceImpl with original eXERD TermModelPackage/EFactory\",\"resourceErrors\":0,\"unresolvedReferences\":0,\"objectCounts\":{"+String.join(",",countFields)+"},\"uiReopenVerified\":false}");
  }
}
