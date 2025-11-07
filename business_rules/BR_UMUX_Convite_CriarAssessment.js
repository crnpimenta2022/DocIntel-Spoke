// Business Rule: BR_UMUX_Convite_CriarAssessment - USANDO AssessmentUtils
// Application: PM Product (x_snc_pmprod)
// Table: x_snc_pmprod_convite
// When: after
// Insert: true
// Update: false
// Order: 200
// Active: true
// Description: Cria Assessment Instance usando API oficial AssessmentUtils

(function executeRule(current, previous /*null when async*/) {
    'use strict';

    try {
        // Verificar se já tem Assessment Instance (evitar duplicação)
        if (current.getValue('assessment_instance')) {
            gs.debug('BR_UMUX_Convite_CriarAssessment: Convite já possui Assessment Instance, ignorando');
            return;
        }

        // Buscar a pesquisa relacionada
        var pesquisaGR = current.pesquisa.getRefRecord();
        if (!pesquisaGR || !pesquisaGR.isValidRecord()) {
            gs.error('BR_UMUX_Convite_CriarAssessment: Pesquisa inválida para convite ' + current.getUniqueValue());
            return;
        }

        // Validar que é uma pesquisa UMUX ativa
        if (pesquisaGR.getValue('tipo') !== 'UMUX' || pesquisaGR.getValue('estado') !== 'ativa') {
            gs.warn('BR_UMUX_Convite_CriarAssessment: Pesquisa não é UMUX ativa, ignorando');
            return;
        }

        // Buscar o Metric Type UMUX
        var metricTypeGR = new GlideRecord('asmt_metric_type');
        metricTypeGR.addQuery('name', 'UMUX Survey');
        metricTypeGR.query();

        if (!metricTypeGR.next()) {
            gs.error('BR_UMUX_Convite_CriarAssessment: UMUX Survey Metric Type não encontrado');
            return;
        }

        var metricTypeId = metricTypeGR.getUniqueValue();
        var userId = current.getValue('usuario');

        gs.info('BR_UMUX_Convite_CriarAssessment: Criando Assessment Instance para convite ' +
                current.getUniqueValue() + ' | Usuário: ' + userId);

        // USAR API OFICIAL: AssessmentUtils.createAssessments()
        // Retorna: "instanceId,groupId" ou apenas "instanceId"
        var assessmentUtils = new global.AssessmentUtils();
        var result = assessmentUtils.createAssessments(metricTypeId, '', userId);

        if (!result) {
            gs.error('BR_UMUX_Convite_CriarAssessment: AssessmentUtils retornou vazio');
            return;
        }

        // Parse do resultado (formato: "instanceId,groupId" ou "instanceId")
        var resultParts = result.split(',');
        var assessmentId = resultParts[0];

        if (!assessmentId) {
            gs.error('BR_UMUX_Convite_CriarAssessment: Falha ao extrair instanceId do resultado: ' + result);
            return;
        }

        gs.info('BR_UMUX_Convite_CriarAssessment: Assessment Instance criado: ' + assessmentId);

        // Atualizar o Assessment Instance com rastreabilidade e estado
        var assessmentGR = new GlideRecord('asmt_assessment_instance');
        if (assessmentGR.get(assessmentId)) {
            // Rastreabilidade
            assessmentGR.setValue('source_table', current.getTableName());
            assessmentGR.setValue('source_id', current.getUniqueValue());
            assessmentGR.setValue('trigger_id', current.getUniqueValue());
            assessmentGR.setValue('trigger_table', current.getTableName());

            // IMPORTANTE: Forçar estado para 'wip' (Work In Progress)
            // Isso impede que o ServiceNow complete automaticamente
            assessmentGR.setValue('state', 'wip');

            assessmentGR.setWorkflow(false); // Evitar disparar outras BRs
            assessmentGR.update();

            gs.info('BR_UMUX_Convite_CriarAssessment: Assessment atualizado com rastreabilidade');
        }

        // Atualizar convite com referência ao Assessment
        current.setValue('assessment_instance', assessmentId);

        // Só mudar estado se ainda estiver pendente
        if (current.getValue('estado') === 'pendente') {
            current.setValue('estado', 'enviado');
            current.setValue('data_envio', new GlideDateTime());
        }

        current.setWorkflow(false); // Evitar recursão
        current.update();

        gs.info('BR_UMUX_Convite_CriarAssessment: Convite atualizado com Assessment Instance');

    } catch (ex) {
        gs.error('BR_UMUX_Convite_CriarAssessment: Exceção ao processar convite: ' + ex.message);
        gs.error('Stack trace: ' + ex.stack);
    }

})(current, previous);
