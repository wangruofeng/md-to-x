export class EditHistory {
  constructor(current, saved) {
    this.entries = saved?.entries?.length ? saved.entries : [current];
    this.index = saved?.entries?.length ? saved.index : 0;
    if (!Number.isInteger(this.index) || !this.entries[this.index]) {
      this.entries = [current];
      this.index = 0;
    }
    this.record(current);
  }
  record(value) {
    const previous = this.entries[this.index];
    if (previous.source === value.source && previous.title === value.title)
      return;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(value);
    // Keep local storage bounded, including articles containing inline images.
    let size = this.entries.reduce(
      (sum, e) => sum + (e.source.length + e.title.length) * 2,
      0,
    );
    while (
      this.entries.length > 1 &&
      (this.entries.length > 100 || size > 4 * 1024 * 1024)
    ) {
      const removed = this.entries.shift();
      size -= (removed.source.length + removed.title.length) * 2;
    }
    this.index = this.entries.length - 1;
  }
  move(direction) {
    const index = this.index + direction;
    if (!this.entries[index]) return null;
    this.index = index;
    return this.entries[index];
  }
  serialize() {
    return { entries: this.entries, index: this.index };
  }
}
