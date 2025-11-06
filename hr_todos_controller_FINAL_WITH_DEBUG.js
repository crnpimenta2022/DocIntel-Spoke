function HRTodosSummaryController($scope, $window, $timeout, $interval, spUtil, $q) {
    'use strict';
    var ctrl = this;

    // ============================================================================
    // CONSTANTS AND CONFIGURATION
    // ============================================================================

    var CONSTANTS = {
        REFRESH_INTERVAL: 300000,      // 5 minutes
        DEBOUNCE_DELAY: 300,           // 300ms for search
        MAX_RETRIES: 3,
        RETRY_DELAY: 1000,
        ANIMATION_DURATION: 300,
        STATES: {
            PENDING: 'requested',
            APPROVED: 'approved',
            REJECTED: 'rejected',
            CANCELLED: 'cancelled'
        },
        TABS: {
            PENDING: 'pending',
            COMPLETED: 'completed',
            CLOSED: 'closed'
        },
        ACTIONS: {
            APPROVE: 'approve',
            REJECT: 'reject',
            DELEGATE: 'delegate',
            REASSIGN: 'reassign',
            CANCEL: 'cancel'
        }
    };

    // ============================================================================
    // STATE MANAGEMENT
    // ============================================================================

    ctrl.todos = [];
    ctrl.filteredTodos = [];
    ctrl.activeTab = CONSTANTS.TABS.PENDING;
    ctrl.searchText = '';
    ctrl.isLoading = false;
    ctrl.error = null;
    ctrl.stats = {
        pending: 0,
        completed: 0,
        closed: 0,
        total: 0
    };

    // ============================================================================
    // PRIVATE VARIABLES
    // ============================================================================

    var timers = {
        refresh: null,
        debounce: []
    };

    var requestCounter = 0;
    var activeRequests = {};
    var eventListeners = [];
    var isVisible = true;

    // ============================================================================
    // LIFECYCLE METHODS
    // ============================================================================

    ctrl.$onInit = function() {
        console.log('[HR Todos] Controller initializing...');

        // Initialize from server data if available
        if ($scope.data) {
            if ($scope.data.todos) {
                ctrl.todos = $scope.data.todos;
                updateStats();
                applyFilters();
            }
            if ($scope.data.error) {
                ctrl.error = $scope.data.error;
            }
        }

        // Set up auto-refresh
        setupAutoRefresh();

        // Set up visibility change detection
        setupVisibilityDetection();

        // Set up event listeners
        setupEventListeners();

        console.log('[HR Todos] Controller initialized with ' + ctrl.todos.length + ' todos');
    };

    ctrl.$onDestroy = function() {
        console.log('[HR Todos] Controller destroying, cleaning up...');
        cleanup();
    };

    // ============================================================================
    // DATA LOADING - WITH DEBUG LOGGING
    // ============================================================================

    ctrl.loadTodos = function(forceRefresh) {
        console.log('[HR Todos] ===== loadTodos called =====');
        console.log('[HR Todos] forceRefresh:', forceRefresh);
        console.log('[HR Todos] isLoading:', ctrl.isLoading);

        if (ctrl.isLoading && !forceRefresh) {
            console.log('[HR Todos] Already loading, skipping...');
            return;
        }

        var requestId = ++requestCounter;
        ctrl.isLoading = true;
        ctrl.error = null;

        console.log('[HR Todos] Making server request, requestId:', requestId);
        console.log('[HR Todos] Current requestCounter:', requestCounter);

        spUtil.update($scope).then(function(response) {
            console.log('[HR Todos] ===== SERVER RESPONSE RECEIVED =====');
            console.log('[HR Todos] Full response object:', response);
            console.log('[HR Todos] response.data:', response.data);

            if (response.data) {
                console.log('[HR Todos] response.data.todos:', response.data.todos);
                console.log('[HR Todos] Todos count:', response.data.todos ? response.data.todos.length : 0);
                console.log('[HR Todos] response.data.stats:', response.data.stats);
                console.log('[HR Todos] response.data.error:', response.data.error);

                if (response.data.todos && response.data.todos.length > 0) {
                    console.log('[HR Todos] First todo sample:', response.data.todos[0]);
                }
            }
            console.log('[HR Todos] ========================================');

            // Check for stale response
            if (requestId !== requestCounter) {
                console.log('[HR Todos] IGNORING stale response - requestId:', requestId, 'current:', requestCounter);
                return;
            }

            handleTodosResponse(response.data);
        }, function(error) {
            console.error('[HR Todos] ===== SERVER ERROR =====');
            console.error('[HR Todos] Error object:', error);
            console.error('[HR Todos] Error message:', error.message || error);
            console.error('[HR Todos] Error data:', error.data);
            console.error('[HR Todos] ========================');

            if (requestId !== requestCounter) {
                return;
            }

            ctrl.isLoading = false;
            ctrl.error = translateError('ERROR_LOADING');
        });
    };

    function handleTodosResponse(data) {
        console.log('[HR Todos] handleTodosResponse called with data:', data);

        ctrl.isLoading = false;

        if (data && data.error) {
            console.error('[HR Todos] Server returned error:', data.error);
            ctrl.error = data.error;
            return;
        }

        if (data && data.todos) {
            console.log('[HR Todos] Setting ctrl.todos to ' + data.todos.length + ' items');
            ctrl.todos = data.todos;
            updateStats();
            applyFilters();
            console.log('[HR Todos] After applyFilters, filteredTodos count:', ctrl.filteredTodos.length);
        } else {
            console.warn('[HR Todos] No todos in response data');
            ctrl.todos = [];
            ctrl.filteredTodos = [];
        }
    }

    // ============================================================================
    // TAB MANAGEMENT
    // ============================================================================

    ctrl.setActiveTab = function(tab) {
        if (ctrl.activeTab === tab) {
            return;
        }

        ctrl.activeTab = tab;
        applyFilters();
    };

    ctrl.isActiveTab = function(tab) {
        return ctrl.activeTab === tab;
    };

    // ============================================================================
    // SEARCH AND FILTERING
    // ============================================================================

    ctrl.onSearchChange = function() {
        // Cancel any pending debounce timers
        timers.debounce.forEach(function(timer) {
            $timeout.cancel(timer);
        });
        timers.debounce = [];

        // Debounce the filter application
        var timer = $timeout(function() {
            applyFilters();
        }, CONSTANTS.DEBOUNCE_DELAY);

        timers.debounce.push(timer);
    };

    ctrl.clearSearch = function() {
        ctrl.searchText = '';
        applyFilters();
    };

    function applyFilters() {
        var filtered = ctrl.todos.slice();

        // Filter by tab
        filtered = filterByTab(filtered, ctrl.activeTab);

        // Filter by search text
        if (ctrl.searchText && ctrl.searchText.trim()) {
            filtered = filterBySearch(filtered, ctrl.searchText.trim().toLowerCase());
        }

        ctrl.filteredTodos = filtered;
    }

    function filterByTab(todos, tab) {
        switch (tab) {
            case CONSTANTS.TABS.PENDING:
                return todos.filter(function(todo) {
                    return todo.state === CONSTANTS.STATES.PENDING;
                });
            case CONSTANTS.TABS.COMPLETED:
                return todos.filter(function(todo) {
                    return todo.state === CONSTANTS.STATES.APPROVED ||
                           todo.state === CONSTANTS.STATES.REJECTED;
                });
            case CONSTANTS.TABS.CLOSED:
                return todos.filter(function(todo) {
                    return todo.state === CONSTANTS.STATES.CANCELLED;
                });
            default:
                return todos;
        }
    }

    function filterBySearch(todos, searchText) {
        return todos.filter(function(todo) {
            return (
                (todo.number && todo.number.toLowerCase().indexOf(searchText) !== -1) ||
                (todo.short_description && todo.short_description.toLowerCase().indexOf(searchText) !== -1) ||
                (todo.requester_name && todo.requester_name.toLowerCase().indexOf(searchText) !== -1)
            );
        });
    }

    // ============================================================================
    // STATISTICS
    // ============================================================================

    function updateStats() {
        ctrl.stats = {
            pending: 0,
            completed: 0,
            closed: 0,
            total: ctrl.todos.length
        };

        ctrl.todos.forEach(function(todo) {
            if (todo.state === CONSTANTS.STATES.PENDING) {
                ctrl.stats.pending++;
            } else if (todo.state === CONSTANTS.STATES.APPROVED ||
                      todo.state === CONSTANTS.STATES.REJECTED) {
                ctrl.stats.completed++;
            } else if (todo.state === CONSTANTS.STATES.CANCELLED) {
                ctrl.stats.closed++;
            }
        });
    }

    // ============================================================================
    // TODO ACTIONS
    // ============================================================================

    ctrl.performAction = function(todo, action) {
        if (!todo || !action) {
            return;
        }

        // Prevent duplicate requests
        var requestKey = todo.sys_id + '_' + action;
        if (activeRequests[requestKey]) {
            console.log('[HR Todos] Action already in progress:', requestKey);
            return;
        }

        // Show confirmation dialog
        if (action === CONSTANTS.ACTIONS.APPROVE || action === CONSTANTS.ACTIONS.REJECT) {
            var message = action === CONSTANTS.ACTIONS.APPROVE
                ? 'Tem certeza que deseja aprovar este item?'
                : 'Tem certeza que deseja rejeitar este item?';

            if (!$window.confirm(message)) {
                return;
            }
        }

        // Mark as processing
        todo.isProcessing = true;
        activeRequests[requestKey] = true;

        // Call server
        var serverData = {
            action: 'performAction',
            todoId: todo.sys_id,
            actionType: action
        };

        spUtil.update($scope, serverData).then(
            function(response) {
                delete activeRequests[requestKey];
                todo.isProcessing = false;

                if (response.data && response.data.success) {
                    // Optimistic update
                    if (action === CONSTANTS.ACTIONS.APPROVE) {
                        todo.state = CONSTANTS.STATES.APPROVED;
                    } else if (action === CONSTANTS.ACTIONS.REJECT) {
                        todo.state = CONSTANTS.STATES.REJECTED;
                    }

                    updateStats();
                    applyFilters();

                    // Reload to get fresh data
                    $timeout(function() {
                        ctrl.loadTodos(true);
                    }, 1000);
                } else {
                    handleActionError(response.data);
                }
            },
            function(error) {
                delete activeRequests[requestKey];
                todo.isProcessing = false;
                handleActionError(error);
            }
        );
    };

    function handleActionError(error) {
        var message = error && error.message
            ? error.message
            : 'Erro ao processar ação. Tente novamente.';

        spUtil.addErrorMessage(message);
    }

    // ============================================================================
    // NAVIGATION
    // ============================================================================

    ctrl.openTodo = function(todo) {
        if (!todo || !todo.source_table || !todo.document_id) {
            return;
        }

        var url = '?id=form&table=' + todo.source_table + '&sys_id=' + todo.document_id;
        $window.open(url, '_blank');
    };

    // ============================================================================
    // AUTO-REFRESH
    // ============================================================================

    function setupAutoRefresh() {
        timers.refresh = $interval(function() {
            if (isVisible) {
                ctrl.loadTodos(true);
            }
        }, CONSTANTS.REFRESH_INTERVAL);
    }

    // ============================================================================
    // VISIBILITY DETECTION
    // ============================================================================

    function setupVisibilityDetection() {
        var hidden, visibilityChange;

        if (typeof document.hidden !== 'undefined') {
            hidden = 'hidden';
            visibilityChange = 'visibilitychange';
        } else if (typeof document.webkitHidden !== 'undefined') {
            hidden = 'webkitHidden';
            visibilityChange = 'webkitvisibilitychange';
        }

        if (visibilityChange) {
            document.addEventListener(visibilityChange, function() {
                isVisible = !document[hidden];
                if (isVisible) {
                    ctrl.loadTodos(true);
                }
            }, false);
        }
    }

    // ============================================================================
    // EVENT LISTENERS
    // ============================================================================

    function setupEventListeners() {
        // Listen for todo updates from other widgets
        var todoUpdateListener = $scope.$on('hr.todo.updated', function(event, data) {
            ctrl.loadTodos(true);
        });
        eventListeners.push(todoUpdateListener);

        // Listen for approval changes
        var approvalListener = $scope.$on('approval.updated', function(event, data) {
            ctrl.loadTodos(true);
        });
        eventListeners.push(approvalListener);
    }

    // ============================================================================
    // UTILITIES
    // ============================================================================

    function translateError(key) {
        var messages = {
            'ERROR_LOADING': 'Erro ao carregar tarefas. Tente novamente.',
            'ERROR_ACTION': 'Erro ao processar ação. Tente novamente.',
            'ERROR_PERMISSION': 'Você não tem permissão para executar esta ação.',
            'ERROR_NOT_FOUND': 'Item não encontrado.'
        };

        return messages[key] || messages.ERROR_LOADING;
    }

    ctrl.formatDate = function(dateString) {
        if (!dateString) {
            return '';
        }

        try {
            var date = new Date(dateString);
            return date.toLocaleDateString('pt-BR');
        } catch (e) {
            return dateString;
        }
    };

    ctrl.isOverdue = function(todo) {
        if (!todo || !todo.due_date) {
            return false;
        }

        try {
            var dueDate = new Date(todo.due_date);
            var now = new Date();
            return dueDate < now && todo.state === CONSTANTS.STATES.PENDING;
        } catch (e) {
            return false;
        }
    };

    // ============================================================================
    // CLEANUP - CRITICAL: INSIDE CONTROLLER SCOPE
    // ============================================================================

    function cleanup() {
        console.log('[HR Todos] Starting cleanup...');

        // Cancel refresh timer
        if (timers.refresh) {
            $interval.cancel(timers.refresh);
            timers.refresh = null;
        }

        // Cancel all debounce timers
        timers.debounce.forEach(function(timer) {
            $timeout.cancel(timer);
        });
        timers.debounce = [];

        // Unregister event listeners
        eventListeners.forEach(function(listener) {
            if (listener && typeof listener === 'function') {
                listener();
            }
        });
        eventListeners = [];

        // Clear active requests
        activeRequests = {};

        console.log('[HR Todos] Cleanup complete');
    }

    // ============================================================================
    // HELPER METHODS FOR TEMPLATE
    // ============================================================================

    ctrl.hasActiveTodos = function() {
        return ctrl.filteredTodos && ctrl.filteredTodos.length > 0;
    };

    ctrl.getEmptyMessage = function() {
        if (ctrl.searchText && ctrl.searchText.trim()) {
            return 'Nenhum item encontrado para "' + ctrl.searchText + '"';
        }

        switch (ctrl.activeTab) {
            case CONSTANTS.TABS.PENDING:
                return 'Nenhuma aprovação pendente';
            case CONSTANTS.TABS.COMPLETED:
                return 'Nenhuma aprovação concluída';
            case CONSTANTS.TABS.CLOSED:
                return 'Nenhuma aprovação cancelada';
            default:
                return 'Nenhum item encontrado';
        }
    };

    ctrl.canApprove = function(todo) {
        return todo && todo.state === CONSTANTS.STATES.PENDING && !todo.isProcessing;
    };

    ctrl.canReject = function(todo) {
        return todo && todo.state === CONSTANTS.STATES.PENDING && !todo.isProcessing;
    };

    ctrl.getStateLabel = function(todo) {
        if (!todo || !todo.state) {
            return '';
        }

        var labels = {
            'requested': 'Pendente',
            'approved': 'Aprovado',
            'rejected': 'Rejeitado',
            'cancelled': 'Cancelado'
        };

        return labels[todo.state] || todo.state;
    };

    ctrl.getStateClass = function(todo) {
        if (!todo || !todo.state) {
            return '';
        }

        var classes = {
            'requested': 'label-warning',
            'approved': 'label-success',
            'rejected': 'label-danger',
            'cancelled': 'label-default'
        };

        return classes[todo.state] || '';
    };

    // ============================================================================
    // INITIALIZATION COMPLETE
    // ============================================================================

    console.log('[HR Todos] Controller function definition complete');
}
