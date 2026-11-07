Component({
  properties: {
    task: {
      type: Object,
      value: null
    }
  },
  methods: {
    onTap() {
      if (!this.data.task) return
      this.triggerEvent('select', { task: this.data.task })
    }
  }
})
