import java.nio.file.*;
import java.util.*;
import org.eclipse.emf.common.util.URI;
import org.eclipse.emf.ecore.*;
import com.tomato.exerd.model.exerd.*;
import com.tomato.exerd.model.exerd.resource.*;
/** Unmodified vendor forward APIs, no GUI, credentials, or server connections. */
public final class OriginalEnterpriseDdl {
 static void put(EObject o,String key,Object value){var f=o.eClass().getEStructuralFeature(key);if(f==null)throw new IllegalArgumentException("Unknown option "+key);o.eSet(f,value);}
 public static void main(String[] args)throws Exception{
  OriginalExerdOracle.originalPackages();
  var resource=new ErdResourceImpl(URI.createFileURI(Path.of(args[0]).toAbsolutePath().toString()));
  var load=new HashMap<Object,Object>(ExerdResourceOptions.getXMLLoadOptions());load.put("PROGRESS_MONITOR",new org.eclipse.core.runtime.NullProgressMonitor());resource.load(load);
  if(!resource.getErrors().isEmpty())throw new IllegalArgumentException(resource.getErrors().toString());
  var doc=(Document)resource.getContents().get(0);String factoryName,generatorName;
  switch(doc.getProductId()){
   case "com.tomato.db.sqlserver_2005":factoryName="com.tomato.exerd.product.sqlserver.forward.model.core.SQLServerForwardFactory";generatorName="com.tomato.exerd.product.sqlserver.forward.ddlgenerator.DDLGenerator";break;
   case "com.tomato.db.db2":factoryName="com.tomato.exerd.product.db2.forward.model.core.DB2ForwardFactory";generatorName="com.tomato.exerd.product.db2.forward.ddlgenerator.DDLGenerator";break;
   case "com.tomato.db.cubrid10":case "com.tomato.db.cubrid":factoryName="com.tomato.exerd.product.cubrid.model.forward.core.CubridForwardFactory";generatorName="com.tomato.exerd.product.cubrid.forward."+(doc.getProductId().endsWith("10")?"cubrid10":"cubrid9")+".ddlgenerator.DDLGenerator";break;
   default:throw new IllegalArgumentException("Unsupported source product");
  }
  var factory=Class.forName(factoryName).getField("eINSTANCE").get(null);var factoryClass=Class.forName(factoryName);
  var config=(EObject)factoryClass.getMethod("createForwardConfiguration").invoke(factory);
  var context=(EObject)factoryClass.getMethod("createForwardContext").invoke(factory);put(context,"document",doc);put(context,"configuration",config);
  var enabled=new ArrayList<String>();
  for(var key:List.of("useOwnerPrefix","createTable","addPrimaryKeyConstraint","addForeignKeyConstraint","addUniqueConstraint","addCheckConstraint","createPrimaryKeyIndex","createPrimaryIndex","createLinkedUniqueIndex","createUniqueIndex","createNonUniqueIndex","useTablePhysicalProperties","useIndexPhysicalProperties","useConstraintPhysicalProperties"))if(config.eClass().getEStructuralFeature(key)!=null){put(config,key,true);enabled.add(key);}
  var delim=config.eClass().getEStructuralFeature("delimitedIdentifier");var en=(EEnum)delim.getEType();
  var literal=en.getELiterals().stream().filter(l->l.getName().contains(doc.getProductId().contains("sqlserver")?"SQUARE":"DOUBLE")).findFirst().orElseThrow();put(config,"delimitedIdentifier",literal.getInstance());
  var separator=config.eClass().getEStructuralFeature("statementSeparator");if(separator!=null)put(config,"statementSeparator",";");
  var up=config.eClass().getEStructuralFeature("userDefineProperties");if(up!=null){var comment=((EEnum)up.getEType()).getEEnumLiteral("COMMENT");if(comment!=null)((List<Object>)config.eGet(up)).add(comment.getInstance());}
  var models=(List<Object>)context.eGet(context.eClass().getEStructuralFeature("models"));var it=doc.eAllContents();while(it.hasNext()){var o=it.next();if(o instanceof Table)models.add(o);}
  var generator=Class.forName(generatorName).getConstructor().newInstance();
  for(var method:generator.getClass().getMethods())if((method.getName().equals("setContext")||method.getName().equals("setRequest"))&&method.getParameterCount()==1)method.invoke(generator,context);
  String sql;if(doc.getProductId().contains("sqlserver"))sql=(String)generator.getClass().getMethod("generateDDLWithSeparator",String.class).invoke(generator,";\n\n");else sql=(String)generator.getClass().getMethod("generateWithSeparator").invoke(generator);
  Files.writeString(Path.of(args[1]),sql);System.out.println("{\"tables\":"+models.size()+",\"characters\":"+sql.length()+",\"productId\":"+OriginalExerdOracle.q(doc.getProductId())+",\"enabledOptions\":["+String.join(",",enabled.stream().map(OriginalExerdOracle::q).toList())+"],\"delimiter\":"+OriginalExerdOracle.q(literal.getName())+",\"originalGenerator\":true,\"gui\":false,\"serverExecution\":false}");
 }
}
