// ADD THIS DEBUG CODE TO YOUR ctrl.loadTodos FUNCTION
// Place this right after: ctrl.loadTodos = function(forceRefresh) {

ctrl.loadTodos = function(forceRefresh) {
    console.log('[HR Todos] loadTodos called, forceRefresh:', forceRefresh);

    if (ctrl.isLoading && !forceRefresh) {
        console.log('[HR Todos] Already loading, skipping...');
        return;
    }

    var requestId = ++requestCounter;
    ctrl.isLoading = true;
    ctrl.error = null;

    console.log('[HR Todos] Making server request, requestId:', requestId);

    spUtil.update($scope).then(function(response) {
        console.log('[HR Todos] ===== SERVER RESPONSE =====');
        console.log('[HR Todos] Full response:', response);
        console.log('[HR Todos] response.data:', response.data);

        if (response.data) {
            console.log('[HR Todos] todos:', response.data.todos);
            console.log('[HR Todos] todos count:', response.data.todos ? response.data.todos.length : 0);
            console.log('[HR Todos] stats:', response.data.stats);
            console.log('[HR Todos] error:', response.data.error);
        }
        console.log('[HR Todos] ========================');

        // Check for stale response
        if (requestId !== requestCounter) {
            console.log('[HR Todos] Ignoring stale response, requestId:', requestId, 'current:', requestCounter);
            return;
        }

        handleTodosResponse(response.data);
    }, function(error) {
        console.error('[HR Todos] ===== SERVER ERROR =====');
        console.error('[HR Todos] Error object:', error);
        console.error('[HR Todos] Error message:', error.message || error);
        console.error('[HR Todos] ========================');

        if (requestId !== requestCounter) {
            return;
        }

        ctrl.isLoading = false;
        ctrl.error = translateError('ERROR_LOADING');
    });
};
