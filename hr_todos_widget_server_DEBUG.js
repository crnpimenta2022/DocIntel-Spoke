(function() {
    'use strict';

    // ============================================================================
    // DEBUG VERSION - Server Script with Enhanced Logging
    // ============================================================================

    console.log('[HR Todos Server] ===== SCRIPT EXECUTING =====');
    console.log('[HR Todos Server] Current user sys_id:', gs.getUserID());
    console.log('[HR Todos Server] Current user name:', gs.getUserName());

    // Initialize data object
    data.todos = [];
    data.stats = {
        pending: 0,
        completed: 0,
        closed: 0,
        total: 0
    };
    data.error = null;

    try {
        // Get current user
        var userId = gs.getUserID();
        console.log('[HR Todos Server] Querying approvals for user:', userId);

        // Query sysapproval_approver table
        var approvalGR = new GlideRecord('sysapproval_approver');
        approvalGR.addQuery('approver', userId);
        approvalGR.addQuery('state', 'requested');
        approvalGR.addActiveQuery();
        approvalGR.orderByDesc('sys_created_on');
        approvalGR.setLimit(100);

        console.log('[HR Todos Server] Encoded query:', approvalGR.getEncodedQuery());

        approvalGR.query();

        console.log('[HR Todos Server] Query executed, row count:', approvalGR.getRowCount());

        var todosList = [];
        var recordCount = 0;

        while (approvalGR.next()) {
            recordCount++;
            console.log('[HR Todos Server] Processing record #' + recordCount);
            console.log('[HR Todos Server]   - sys_id:', approvalGR.getValue('sys_id'));
            console.log('[HR Todos Server]   - document_id:', approvalGR.getValue('document_id'));
            console.log('[HR Todos Server]   - source_table:', approvalGR.getValue('source_table'));

            var todo = {
                sys_id: approvalGR.getValue('sys_id'),
                document_id: approvalGR.getValue('document_id'),
                source_table: approvalGR.getValue('source_table'),
                state: approvalGR.getValue('state'),
                due_date: approvalGR.getValue('due_date'),
                comments: approvalGR.getValue('comments'),
                sys_created_on: approvalGR.getValue('sys_created_on')
            };

            // Get source document details
            var sourceTable = approvalGR.getValue('source_table');
            var documentId = approvalGR.getValue('document_id');

            console.log('[HR Todos Server]   - Fetching source document from table:', sourceTable);

            if (sourceTable && documentId) {
                try {
                    var sourceGR = new GlideRecord(sourceTable);
                    if (sourceGR.get(documentId)) {
                        console.log('[HR Todos Server]   - Source document found');

                        todo.number = sourceGR.getValue('number') || '';
                        todo.short_description = sourceGR.getValue('short_description') || '';
                        todo.description = sourceGR.getValue('description') || '';

                        // Get requester info if available
                        var requesterField = sourceGR.getValue('opened_by') ||
                                           sourceGR.getValue('requested_for') ||
                                           sourceGR.getValue('sys_created_by');

                        if (requesterField) {
                            var userGR = new GlideRecord('sys_user');
                            if (userGR.get(requesterField)) {
                                todo.requester_name = userGR.getDisplayValue();
                                console.log('[HR Todos Server]   - Requester:', todo.requester_name);
                            }
                        }

                        console.log('[HR Todos Server]   - Number:', todo.number);
                        console.log('[HR Todos Server]   - Short desc:', todo.short_description);
                    } else {
                        console.log('[HR Todos Server]   - WARNING: Source document not found!');
                        todo.error = 'Source document not accessible';
                    }
                } catch (sourceError) {
                    console.error('[HR Todos Server]   - ERROR fetching source:', sourceError.message);
                    todo.error = 'Error accessing source: ' + sourceError.message;
                }
            }

            todosList.push(todo);
            console.log('[HR Todos Server]   - Todo added to list');
        }

        console.log('[HR Todos Server] Total todos processed:', todosList.length);

        // Set data
        data.todos = todosList;
        data.stats.pending = todosList.length;
        data.stats.total = todosList.length;

        console.log('[HR Todos Server] ===== FINAL DATA =====');
        console.log('[HR Todos Server] Todos count:', data.todos.length);
        console.log('[HR Todos Server] Stats:', JSON.stringify(data.stats));
        console.log('[HR Todos Server] ========================');

    } catch (error) {
        console.error('[HR Todos Server] ===== FATAL ERROR =====');
        console.error('[HR Todos Server] Error message:', error.message);
        console.error('[HR Todos Server] Stack:', error.stack);
        console.error('[HR Todos Server] ========================');

        data.error = 'Error loading todos: ' + error.message;
        data.todos = [];
    }

    console.log('[HR Todos Server] Script execution complete');

})();
