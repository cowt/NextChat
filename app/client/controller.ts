// To store message streaming controller
export const ChatControllerPool = {
  controllers: {} as Record<string, AbortController>,

  addController(
    sessionId: string,
    messageId: string,
    controller: AbortController,
  ) {
    const key = this.key(sessionId, messageId);
    this.controllers[key] = controller;
    return key;
  },

  stop(sessionId: string, messageId: string) {
    const key = this.key(sessionId, messageId);
    const controller = this.controllers[key];
    controller?.abort();
  },

  stopAll() {
    Object.values(this.controllers).forEach((v) => v.abort());
  },

  hasPending() {
    return Object.values(this.controllers).length > 0;
  },

  // Check whether the current session has any pending controllers
  hasPendingSession(sessionId: string) {
    const prefix = `${sessionId},`;
    return Object.keys(this.controllers).some((key) => key.startsWith(prefix));
  },

  // Stop all pending controllers for a specific session
  stopSession(sessionId: string) {
    const prefix = `${sessionId},`;
    Object.entries(this.controllers).forEach(([key, controller]) => {
      if (key.startsWith(prefix)) {
        controller?.abort();
        delete this.controllers[key];
      }
    });
  },

  remove(sessionId: string, messageId: string) {
    const key = this.key(sessionId, messageId);
    delete this.controllers[key];
  },

  key(sessionId: string, messageIndex: string) {
    return `${sessionId},${messageIndex}`;
  },
};
