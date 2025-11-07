# Business Rules

This directory contains ServiceNow Business Rules for the PM Product application.

## BR_UMUX_Convite_CriarAssessment

**Purpose**: Automatically creates an Assessment Instance using the official AssessmentUtils API when a UMUX survey invitation (convite) is created.

**Configuration**:
- **Table**: `x_snc_pmprod_convite`
- **When**: After Insert
- **Order**: 200
- **Active**: Yes

**Functionality**:

1. **Duplicate Prevention**: Checks if the invitation already has an associated Assessment Instance
2. **Validation**: Verifies that the related survey (pesquisa) is an active UMUX survey
3. **Assessment Creation**: Uses the official `AssessmentUtils.createAssessments()` API to create the assessment
4. **Traceability**: Sets source tracking fields on the Assessment Instance:
   - `source_table`, `source_id`, `trigger_table`, `trigger_id`
5. **State Management**:
   - Sets Assessment state to 'wip' (Work In Progress) to prevent auto-completion
   - Updates invitation state from 'pendente' to 'enviado'
6. **Error Handling**: Comprehensive try-catch with detailed logging

**Key Features**:
- Uses official ServiceNow API (`AssessmentUtils`) instead of direct database manipulation
- Prevents workflow recursion with `setWorkflow(false)`
- Comprehensive debug/info/error logging for troubleshooting
- Robust validation at each step

**Dependencies**:
- UMUX Survey Metric Type must exist in `asmt_metric_type` table
- Table fields required:
  - `x_snc_pmprod_convite.assessment_instance`
  - `x_snc_pmprod_convite.pesquisa`
  - `x_snc_pmprod_convite.usuario`
  - `x_snc_pmprod_convite.estado`
  - `x_snc_pmprod_convite.data_envio`
