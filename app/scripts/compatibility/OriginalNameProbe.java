import com.tomato.exerd.model.exerd.*;
/** Tests unmodified vendor model setters; UI naming-policy propagation is audited separately. */
public final class OriginalNameProbe {
 public static void main(String[] args) {
  var factory=ExerdFactory.eINSTANCE;
  var pk=factory.createPrimaryKeyColumnGroup();
  var fk=factory.createForeignKeyColumnGroup();
  var ak=factory.createAlternateKeyColumnGroup();
  ak.setUniqueConstraint(factory.createUniqueConstraint());
  probe("PK",pk,pk.getPrimaryKeyConstraint());
  probe("FK",fk,fk.getForeignKeyConstraint());
  probe("UNIQUE",ak,ak.getUniqueConstraint());
 }
 static void probe(String type, NameOwner group, NameOwner constraint) {
  for(boolean derived:new boolean[]{false,true}) {
   group.setPhysicalName("same",true);
   group.setLogicalName("same",true);
   constraint.setPhysicalName("same",derived);
   constraint.setLogicalName("custom-logical",derived);
   group.setPhysicalName("renamed-group");
   group.setLogicalName("renamed-logical-group");
   if(!constraint.getPhysicalName().equals("same") || !constraint.getLogicalName().equals("custom-logical")) throw new AssertionError("Constraint overwritten");
   if(group.isDerivedPhysicalName() || group.isDerivedLogicalName()) throw new AssertionError("Explicit name still derived");
   if(constraint.isDerivedPhysicalName()!=derived || constraint.isDerivedLogicalName()!=derived) throw new AssertionError("Unrelated flag changed");
   System.out.println("{\"type\":\""+type+"\",\"originalConstraintDerived\":"+derived+",\"groupRenameChangedConstraint\":false,\"explicitGroupRenameClearedBothDerivedFlags\":true,\"constraintFlagsPreserved\":true}");
  }
 }
}
