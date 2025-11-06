/**
 * HR Todos Summary Widget - Client Controller (ServiceNow Format)
 *
 * IMPORTANTE: Este formato é específico para o campo "Client Controller" do ServiceNow
 * ServiceNow automaticamente envolve esta função no contexto Angular apropriado
 *
 * @version 2.0
 * @date 2025-11-06
 */

function($scope, $window, $timeout, $interval, spUtil, $q) {
    'use strict';

    var c = this;

    /* ==================== CONSTANTS ==================== */

    var CONSTANTS = {
        // Timing
        RESIZE_DELAY: 200,
        REFRESH_INTERVAL: 30000,
        ANIMATION_DELAY: 100,
        SEARCH_DEBOUNCE: 300,
        ACTION_TIMEOUT: 10000,

        // UI
        PAGE_SIZE: 10,
        MOBILE_BREAKPOINT: 768,
        MAX_PAGE_BUTTONS: 7,

        // Validation
        MAX_SEARCH_LENGTH: 100,
        MIN_PAGE: 1,

        // Tab IDs
        TAB_PENDING: 'pending',
        TAB_COMPLETED: 'completed',
        TAB_CLOSED: 'closed'
    };

    /* ==================== STATE ==================== */

    c.state = {
        loading: true,
        error: null,
        currentTab: CONSTANTS.TAB_PENDING,
        searchQuery: '',
        selectedFilters: {},
        todos: [],
        pagination: {
            page: 1,
            pageSize: CONSTANTS.PAGE_SIZE,
            totalCount: 0,
            totalPages: 0
        }
    };

    c.tabs = [];
    c.options = {};
    c.isCompactView = false;

    /* ==================== PRIVATE VARIABLES ==================== */

    var timers = {
        resize: null,
        refresh: null,
        animation: null,
        debounce: []
    };

    var eventListeners = [];
    var activeRequests = {};
    var currentLoadRequest = null;
    var requestCounter = 0;

    // Cached computations
    var cachedPageNumbers = [];
    var lastPaginationHash = null;

    /* ==================== LIFECYCLE HOOKS ==================== */

    /**
     * Initializes the controller
     */
    c.$onInit = function() {
        try {
            initializeOptions();
            initializeTabs();
            setupEventListeners();
            detectViewportSize();
            startAutoRefresh();
            c.loadTodos();
        } catch (error) {
            handleError('Initialization failed', error, 'Failed to initialize widget');
        }
    };

    /**
     * Cleanup when controller is destroyed
     */
    c.$onDestroy = function() {
        cleanup();
    };

    /* ==================== PUBLIC API ==================== */

    /**
     * Loads todos from server based on current state
     */
    c.loadTodos = function() {
        if (currentLoadRequest && currentLoadRequest.$$state.status === 0) {
            // Request is still pending
        }

        c.state.loading = true;
        c.state.error = null;

        var requestId = ++requestCounter;
        var params = buildRequestParams();

        currentLoadRequest = c.server.get({
            action: 'getTodos',
            params: params
        });

        return currentLoadRequest.then(
            function(response) {
                if (requestId !== requestCounter) {
                    return;
                }

                handleTodosResponse(response.data);
                c.state.loading = false;
            },
            function(error) {
                if (requestId !== requestCounter) {
                    return;
                }

                handleError('Load todos failed', error, 'Failed to load todos');
                c.state.loading = false;
            }
        );
    };

    /**
     * Switches to a different tab
     */
    c.switchTab = function(tabId) {
        if (!tabId || c.state.currentTab === tabId) {
            return;
        }

        var tabExists = c.tabs.some(function(tab) {
            return tab.id === tabId;
        });

        if (!tabExists) {
            console.warn('Invalid tab ID:', tabId);
            return;
        }

        c.state.currentTab = tabId;
        c.state.pagination.page = 1;
        c.state.searchQuery = '';
        c.state.selectedFilters = {};
        c.loadTodos();
    };

    /**
     * Handles search input with debouncing
     */
    c.onSearch = createDebounce(function(query) {
        c.state.searchQuery = sanitizeSearchInput(query);
        c.state.pagination.page = 1;
        c.loadTodos();
    }, CONSTANTS.SEARCH_DEBOUNCE);

    /**
     * Applies filter criteria
     */
    c.applyFilters = function(filters) {
        if (!filters || typeof filters !== 'object') {
            return;
        }

        c.state.selectedFilters = sanitizeFilters(filters);
        c.state.pagination.page = 1;
        c.loadTodos();
    };

    /**
     * Clears all filters and search
     */
    c.clearFilters = function() {
        c.state.selectedFilters = {};
        c.state.searchQuery = '';
        c.state.pagination.page = 1;
        c.loadTodos();
    };

    /**
     * Navigates to specific page
     */
    c.goToPage = function(page) {
        page = parseInt(page, 10);

        if (isNaN(page) || page < CONSTANTS.MIN_PAGE || page > c.state.pagination.totalPages) {
            return;
        }

        if (page === c.state.pagination.page) {
            return;
        }

        c.state.pagination.page = page;
        c.loadTodos();
    };

    /**
     * Goes to next page
     */
    c.nextPage = function() {
        if (c.state.pagination.page < c.state.pagination.totalPages) {
            c.goToPage(c.state.pagination.page + 1);
        }
    };

    /**
     * Goes to previous page
     */
    c.previousPage = function() {
        if (c.state.pagination.page > 1) {
            c.goToPage(c.state.pagination.page - 1);
        }
    };

    /**
     * Refreshes todo list
     */
    c.refresh = function(silent) {
        if (!silent) {
            c.state.loading = true;
        }
        c.loadTodos();
    };

    /**
     * Performs action on todo item
     */
    c.performAction = function(todo, action) {
        if (!todo || !todo.sysId || !action) {
            spUtil.addErrorMessage('Invalid action parameters');
            return $q.reject('Invalid parameters');
        }

        action = sanitizeActionType(action);
        if (!action) {
            spUtil.addErrorMessage('Invalid action type');
            return $q.reject('Invalid action');
        }

        var requestKey = todo.sysId + ':' + action;
        if (activeRequests[requestKey]) {
            return $q.reject('Already processing');
        }

        var actionConfig = getActionConfig(action);

        if (actionConfig.requiresConfirmation) {
            return showActionConfirmation(actionConfig).then(function(confirmed) {
                if (confirmed) {
                    return executeAction(todo, action, requestKey);
                }
                return $q.reject('User cancelled');
            });
        }

        return executeAction(todo, action, requestKey);
    };

    /**
     * Opens todo details
     */
    c.viewTodoDetails = function(todo) {
        if (!todo || !todo.table || !todo.documentId) {
            spUtil.addErrorMessage('Cannot open todo details');
            return;
        }

        try {
            spUtil.openRecord({
                table: todo.table,
                sys_id: todo.documentId
            });
        } catch (error) {
            handleError('View details failed', error, 'Failed to open todo details');
        }
    };

    /**
     * Checks if any filters are active
     */
    c.hasActiveFilters = function() {
        return !!(c.state.searchQuery || Object.keys(c.state.selectedFilters).length > 0);
    };

    /**
     * Gets array of page numbers for pagination UI
     */
    c.getPageNumbers = function() {
        var currentHash = getPaginationHash();

        if (currentHash === lastPaginationHash) {
            return cachedPageNumbers;
        }

        lastPaginationHash = currentHash;
        cachedPageNumbers = computePageNumbers();

        return cachedPageNumbers;
    };

    /**
     * Checks if tab is currently active
     */
    c.isActiveTab = function(tabId) {
        return c.state.currentTab === tabId;
    };

    /* ==================== INITIALIZATION ==================== */

    function initializeOptions() {
        c.options = angular.extend({
            showFilters: true,
            showSearch: true,
            enableAutoRefresh: true,
            compactView: false,
            defaultTab: CONSTANTS.TAB_PENDING,
            labels: {},
            actionConfirmations: true
        }, c.options || {});

        c.state.currentTab = c.options.defaultTab;
    }

    function initializeTabs() {
        var labels = c.options.labels || {};

        c.tabs = [
            {
                id: CONSTANTS.TAB_PENDING,
                label: labels.pending || 'Pending',
                icon: 'clock-o'
            },
            {
                id: CONSTANTS.TAB_COMPLETED,
                label: labels.completed || 'Completed',
                icon: 'check'
            },
            {
                id: CONSTANTS.TAB_CLOSED,
                label: labels.closed || 'Closed',
                icon: 'times'
            }
        ];
    }

    function setupEventListeners() {
        var resizeHandler = createDebounce(function() {
            $scope.$applyAsync(function() {
                detectViewportSize();
            });
        }, CONSTANTS.RESIZE_DELAY);

        $window.addEventListener('resize', resizeHandler);
        eventListeners.push({
            element: $window,
            event: 'resize',
            handler: resizeHandler
        });

        var visibilityHandler = function() {
            if (!document.hidden && c.options.enableAutoRefresh) {
                c.refresh(true);
            }
        };

        document.addEventListener('visibilitychange', visibilityHandler);
        eventListeners.push({
            element: document,
            event: 'visibilitychange',
            handler: visibilityHandler
        });

        var unregisterRefresh = $scope.$on('hr.todos.refresh', function() {
            c.refresh();
        });
        eventListeners.push({
            unregister: unregisterRefresh
        });

        var unregisterUpdate = $scope.$on('hr.todos.updated', function(event, data) {
            handleTodoUpdate(data);
        });
        eventListeners.push({
            unregister: unregisterUpdate
        });
    }

    function startAutoRefresh() {
        if (!c.options.enableAutoRefresh) {
            return;
        }

        timers.refresh = $interval(function() {
            if (document.hidden) {
                return;
            }

            if (!isWidgetVisible()) {
                return;
            }

            c.refresh(true);
        }, CONSTANTS.REFRESH_INTERVAL);
    }

    function detectViewportSize() {
        c.isCompactView = $window.innerWidth < CONSTANTS.MOBILE_BREAKPOINT;
    }

    /* ==================== REQUEST HANDLING ==================== */

    function buildRequestParams() {
        return {
            tab: c.state.currentTab,
            page: c.state.pagination.page,
            pageSize: CONSTANTS.PAGE_SIZE,
            search: c.state.searchQuery,
            filters: c.state.selectedFilters
        };
    }

    function handleTodosResponse(data) {
        if (!data || typeof data !== 'object') {
            handleError('Invalid response', null, 'Invalid server response');
            return;
        }

        if (!data.success && data.error) {
            handleError('Server error', null, data.message || 'Server returned an error');
            return;
        }

        if (!Array.isArray(data.records)) {
            handleError('Invalid records', null, 'Invalid data format');
            return;
        }

        c.state.todos = data.records.map(validateAndSanitizeTodo).filter(Boolean);

        c.state.pagination = {
            page: parseInt(data.page, 10) || 1,
            pageSize: CONSTANTS.PAGE_SIZE,
            totalCount: parseInt(data.totalCount, 10) || 0,
            totalPages: Math.max(0, Math.ceil((parseInt(data.totalCount, 10) || 0) / CONSTANTS.PAGE_SIZE))
        };

        if (timers.animation) {
            $timeout.cancel(timers.animation);
        }

        timers.animation = $timeout(function() {
            c.state.todos = c.state.todos.map(function(todo) {
                return angular.extend({}, todo, { animated: true });
            });
        }, CONSTANTS.ANIMATION_DELAY);
    }

    function validateAndSanitizeTodo(todo) {
        if (!todo || typeof todo !== 'object') {
            return null;
        }

        if (!todo.sysId || !todo.table) {
            console.warn('Invalid todo object:', todo);
            return null;
        }

        return {
            sysId: sanitizeId(todo.sysId),
            table: sanitizeString(todo.table),
            documentId: sanitizeId(todo.documentId),
            number: sanitizeString(todo.number),
            shortDescription: sanitizeString(todo.shortDescription),
            state: sanitizeString(todo.state),
            priority: sanitizeString(todo.priority),
            dueDate: todo.dueDate,
            assignedTo: sanitizeString(todo.assignedTo),
            isProcessing: false,
            animated: false
        };
    }

    function handleTodoUpdate(data) {
        if (!data || !data.todoId) {
            return;
        }

        var todo = c.state.todos.find(function(t) {
            return t.sysId === data.todoId;
        });

        if (todo) {
            if (data.action === 'updated') {
                c.refresh(true);
            } else if (data.action === 'removed') {
                removeTodoFromList(data.todoId);
            }
        }
    }

    function executeAction(todo, action, requestKey) {
        activeRequests[requestKey] = true;
        var originalState = angular.copy(todo);
        todo.isProcessing = true;

        todo.state = getOptimisticState(action);

        var timeoutPromise = $timeout(function() {
            return $q.reject('Request timeout');
        }, CONSTANTS.ACTION_TIMEOUT);

        var requestPromise = c.server.update({
            action: 'performTodoAction',
            todoId: todo.sysId,
            actionType: action
        });

        return $q.race([requestPromise, timeoutPromise]).then(
            function(response) {
                $timeout.cancel(timeoutPromise);

                if (response.data && response.data.success) {
                    spUtil.addInfoMessage(response.data.message || 'Action completed successfully');
                    removeTodoFromList(todo.sysId);
                    return response;
                } else {
                    angular.extend(todo, originalState);
                    spUtil.addErrorMessage(response.data.message || 'Action failed');
                    return $q.reject(response.data.message);
                }
            },
            function(error) {
                $timeout.cancel(timeoutPromise);
                angular.extend(todo, originalState);
                handleError('Action failed', error, 'Failed to perform action');
                return $q.reject(error);
            }
        ).finally(function() {
            delete activeRequests[requestKey];
            todo.isProcessing = false;
        });
    }

    function getOptimisticState(action) {
        var stateMap = {
            approve: 'approved',
            reject: 'rejected',
            complete: 'completed',
            cancel: 'cancelled'
        };
        return stateMap[action] || 'processing';
    }

    function removeTodoFromList(todoId) {
        var index = c.state.todos.findIndex(function(t) {
            return t.sysId === todoId;
        });

        if (index !== -1) {
            c.state.todos.splice(index, 1);
            c.state.pagination.totalCount--;

            if (c.state.todos.length === 0 && c.state.pagination.page > 1) {
                c.state.pagination.page--;
                c.loadTodos();
            }
        }
    }

    /* ==================== ACTION CONFIGURATION ==================== */

    function getActionConfig(action) {
        var configs = {
            approve: {
                label: 'Approve',
                requiresConfirmation: c.options.actionConfirmations,
                confirmTitle: 'Confirm Approval',
                confirmMessage: 'Are you sure you want to approve this item?',
                confirmButton: 'Approve',
                icon: 'check-circle'
            },
            reject: {
                label: 'Reject',
                requiresConfirmation: c.options.actionConfirmations,
                confirmTitle: 'Confirm Rejection',
                confirmMessage: 'Are you sure you want to reject this item?',
                confirmButton: 'Reject',
                icon: 'times-circle'
            },
            delegate: {
                label: 'Delegate',
                requiresConfirmation: false,
                icon: 'share'
            },
            cancel: {
                label: 'Cancel',
                requiresConfirmation: true,
                confirmTitle: 'Confirm Cancellation',
                confirmMessage: 'Are you sure you want to cancel this item?',
                confirmButton: 'Cancel Item',
                icon: 'ban'
            }
        };

        return configs[action] || {
            label: action,
            requiresConfirmation: true,
            confirmTitle: 'Confirm Action',
            confirmMessage: 'Are you sure you want to perform this action?',
            confirmButton: 'Confirm'
        };
    }

    function showActionConfirmation(config) {
        return spUtil.showConfirm(
            config.confirmMessage,
            config.confirmTitle,
            config.confirmButton
        );
    }

    /* ==================== PAGINATION ==================== */

    function computePageNumbers() {
        var pages = [];
        var current = c.state.pagination.page;
        var total = c.state.pagination.totalPages;

        if (total === 0) {
            return pages;
        }

        if (total <= CONSTANTS.MAX_PAGE_BUTTONS) {
            for (var i = 1; i <= total; i++) {
                pages.push(i);
            }
        } else {
            pages.push(1);

            if (current > 3) {
                pages.push('...');
            }

            var start = Math.max(2, current - 1);
            var end = Math.min(current + 1, total - 1);

            for (var j = start; j <= end; j++) {
                pages.push(j);
            }

            if (current < total - 2) {
                pages.push('...');
            }

            pages.push(total);
        }

        return pages;
    }

    function getPaginationHash() {
        return [c.state.pagination.page, c.state.pagination.totalPages].join('|');
    }

    /* ==================== VALIDATION & SANITIZATION ==================== */

    function sanitizeSearchInput(input) {
        if (!input || typeof input !== 'string') {
            return '';
        }

        return input
            .replace(/<script[^>]*>.*?<\/script>/gi, '')
            .replace(/[<>]/g, '')
            .substring(0, CONSTANTS.MAX_SEARCH_LENGTH)
            .trim();
    }

    function sanitizeFilters(filters) {
        var safe = {};
        var allowedKeys = ['priority', 'type', 'assignmentGroup', 'state'];

        allowedKeys.forEach(function(key) {
            if (filters[key]) {
                if (Array.isArray(filters[key])) {
                    safe[key] = filters[key].map(sanitizeString).filter(Boolean);
                } else if (typeof filters[key] === 'string') {
                    var sanitized = sanitizeString(filters[key]);
                    if (sanitized) {
                        safe[key] = [sanitized];
                    }
                }
            }
        });

        return safe;
    }

    function sanitizeString(str) {
        if (!str) {
            return '';
        }

        if (typeof str !== 'string') {
            str = String(str);
        }

        return str.replace(/[<>]/g, '').substring(0, 255).trim();
    }

    function sanitizeId(id) {
        if (!id || typeof id !== 'string') {
            return '';
        }

        if (id.length === 32 && /^[a-f0-9]{32}$/i.test(id)) {
            return id.toLowerCase();
        }

        return '';
    }

    function sanitizeActionType(action) {
        if (!action || typeof action !== 'string') {
            return null;
        }

        var allowed = ['approve', 'reject', 'delegate', 'reassign', 'cancel', 'complete'];
        action = action.toLowerCase().trim();

        return allowed.indexOf(action) !== -1 ? action : null;
    }

    /* ==================== UTILITY FUNCTIONS ==================== */

    function createDebounce(func, wait) {
        var timeout;

        return function() {
            var context = this;
            var args = arguments;

            if (timeout) {
                $timeout.cancel(timeout);
                var index = timers.debounce.indexOf(timeout);
                if (index !== -1) {
                    timers.debounce.splice(index, 1);
                }
            }

            timeout = $timeout(function() {
                func.apply(context, args);

                var idx = timers.debounce.indexOf(timeout);
                if (idx !== -1) {
                    timers.debounce.splice(idx, 1);
                }
            }, wait);

            timers.debounce.push(timeout);
        };
    }

    function isWidgetVisible() {
        try {
            var element = document.querySelector('.hr-todos-widget');
            if (!element) {
                return false;
            }

            var rect = element.getBoundingClientRect();
            return (
                rect.top < $window.innerHeight &&
                rect.bottom > 0 &&
                rect.left < $window.innerWidth &&
                rect.right > 0
            );
        } catch (error) {
            return true;
        }
    }

    function handleError(context, error, userMessage) {
        console.error('[HR Todos]', context, error);
        c.state.error = userMessage || 'An error occurred';
        spUtil.addErrorMessage(userMessage || 'An error occurred');

        if ($window.analytics && typeof $window.analytics.trackError === 'function') {
            $window.analytics.trackError(context, error);
        }
    }

    /**
     * Cleans up resources on destroy - CRITICAL FIX
     * This function MUST be inside the controller function to work correctly
     */
    function cleanup() {
        if (timers.resize) {
            $timeout.cancel(timers.resize);
        }

        if (timers.refresh) {
            $interval.cancel(timers.refresh);
        }

        if (timers.animation) {
            $timeout.cancel(timers.animation);
        }

        timers.debounce.forEach(function(timeout) {
            $timeout.cancel(timeout);
        });

        eventListeners.forEach(function(listener) {
            if (listener.unregister && typeof listener.unregister === 'function') {
                listener.unregister();
            } else if (listener.element && listener.event && listener.handler) {
                listener.element.removeEventListener(listener.event, listener.handler);
            }
        });

        timers.debounce = [];
        eventListeners = [];
        activeRequests = {};
        cachedPageNumbers = [];
        lastPaginationHash = null;
    }
}
