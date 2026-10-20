import java.nio.file.*;
import java.util.*;
import org.eclipse.emf.common.util.URI;
import com.tomato.exerd.model.exerd.*;
import com.tomato.exerd.model.exerd.resource.*;
import com.tomato.exerd.product.oracle10g.oracleForwardModel.*;
import com.tomato.exerd.product.oracle10g.forward.ddlgenerator.DDLGenerator;
public final class OriginalOracleDdl {
 public static void main(String[] args) throws Exception {
  OriginalExerdOracle.originalPackages();
  var resource=new ErdResourceImpl(URI.createFileURI(Path.of(args[0]).toAbsolutePath().toString()));
  var load=new HashMap<Object,Object>(ExerdResourceOptions.getXMLLoadOptions());
  load.put("PROGRESS_MONITOR",new org.eclipse.core.runtime.NullProgressMonitor());resource.load(load);
  if(!resource.getErrors().isEmpty()) throw new IllegalArgumentException(resource.getErrors().toString());
  var doc=(Document)resource.getContents().get(0);
  if(!"com.tomato.db.oracle_10g".equals(doc.getProductId())) throw new IllegalArgumentException("Oracle source document required");
  var factory=OracleForwardFactory.eINSTANCE;
  var req=factory.createForwardRequest(); req.setDocument(doc);req.setUseOwnerPrefix(true);req.setUseQuoteForName(true);
  req.setCreateTable(true);req.setCreateNonUniqueIndex(true);req.setCreateUniqueIndex(true);req.setCreatePrimaryKeyIndex(true);
  req.setAddPrimaryKeyConstraint(true);req.setAddForeignKeyConstraint(true);req.setAddUniqueConstraint(true);req.setAddCheckConstraint(true);
  req.setUseConstraintState(true);req.setUseTablePhysicalProperty(true);req.setUseIndexPhysicalProperty(true);
  req.setUseComment(CommentOption.COMMENT);req.setCommentOptions(CommentOption.COMMENT);
  int tables=0;var it=doc.eAllContents();while(it.hasNext()){var obj=it.next();if(obj instanceof Table){var model=factory.createForwardModel();model.setModel(obj);req.getTable().add(model);tables++;}}
  var generator=new DDLGenerator();generator.setRequest(req);var sql=generator.generateDDLWithSeparator(";\n\n");
  Files.writeString(Path.of(args[1]),sql);System.out.println("{\"tables\":"+tables+",\"characters\":"+sql.length()+",\"originalGenerator\":true,\"gui\":false,\"serverExecution\":false}");
 }
}
