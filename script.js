import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.mjs';
import SelectionArea from 'https://cdn.jsdelivr.net/npm/@viselect/vanilla@3.1.0/lib/viselect.esm.js';
import { marked } from 'https://cdnjs.cloudflare.com/ajax/libs/marked/4.1.0/lib/marked.esm.js';

const $tasks = document.getElementById('tasks');
const CLASS_TASK = 'task';
const CLASS_FOCUSED = 'focused';
const CLASS_EDITING = 'editing';
const CLASS_MOVING = 'moving';
const CLASS_COLOR = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'purple', 'white', 'black'];

const db = new class {
    table;

    constructor() {
        const db = new Dexie('Kanban');
        db.version(1).stores({
            tasks: '&id, color, text, top, left, zindex'
        });
        this.table = db.table('tasks');
    }

    /**
     * @returns {Promise<object[]>}
     */
    getAll() {
        return this.table.toArray();
    }

    async add(option) {
        const id = this.#createId();
        const zindex = await this.getAll().then(records => records.length ? Math.max(...records.map(r => r.zindex)) : 0);
        const { top = 0, left = 0, text = '', color = 'white' } = option;
        this.table.add({
            id,
            color,
            text,
            top,
            left,
            zindex: zindex + 1
        });
        return {
            ...option,
            zindex,
            id
        };
    }

    /**
     * @param {string} id
     * @param {object} option 
     * @param {string} [option.color]
     * @param {string} [option.text]
     * @param {number} [option.top]
     * @param {number} [option.left]
     */
    edit(id, option) {
        return this.table.update(id, {
            ...option
        });
    }

    async toFront(id) {
        const all = await this.getAll().then(records => records.filter(r => r.id !== id).sort((r1, r2) => r1.zindex - r2.zindex));
        let i = 0;
        while (i < all.length) {
            this.table.update(all[i].id, {
                zindex: i++
            });
        }
        return this.table.update(id, {
            zindex: i
        });
    }

    deleteTask(id) {
        return this.table.delete(id);
    }

    #createId() {
        const random =  Array(3).fill(0).map(_ => Math.floor(Math.random() * 16).toString(16)).join('');
        return new Date().getTime().toString(16) + random;
    }
}();

class Task {
    /**
     * @type {Task[]}
     */
    static instances = [];
    static #onDocumentKeyUp = null;

    id;
    elm;
    input;
    displayText;
    origin;

    constructor(id) {
        this.id = id;
        this.elm = document.getElementById(id);
        this.input = this.elm.querySelector('textarea');
        this.displayText = this.elm.querySelector('.display-text');

        this.origin = {
            x: 0,
            y: 0,
            pos: {}
        };
    }

    static async create(option) {
        let { id = '', top = 0, left = 0, text = '', color = '' } = option;
        if (!id) {
            const added = await db.add(option);
            let { id, top, left, text, color } = added;
        }
        const newTask = document.createElement('div');
        newTask.style.top = top + '%';
        newTask.style.left = left + '%';
        newTask.classList.add(CLASS_TASK);
        newTask.classList.add(color);
        newTask.id = id;
        const displayText = document.createElement('div');
        displayText.className = 'display-text';
        displayText.innerHTML = marked.parse(text);
        newTask.appendChild(displayText);
        const textarea = document.createElement('textarea');
        textarea.placeholder = 'Press Ctrl+Enter or Ctrl+Alt+Enter to start a new line,\nCtrl+Shift+Enter to input a hover comment.';
        textarea.value = text;
        newTask.appendChild(textarea);
        $tasks.appendChild(newTask);
        const instance = new Task(id);
        instance.#registerEventListener();
        newTask.oncontextmenu = e => Menu.show(e);
        Task.instances.push(instance);
        return instance;
    }

    #registerEventListener() {
        let focused = [];
        const getMousePosition = event => {
            return {
                x: (event.pageX / window.innerWidth) * 100,
                y: (event.pageY / window.innerHeight) * 100
            }
        };

        const mousedown = event => {
            if (event.ctrlKey) {
                this.elm.classList.toggle(CLASS_FOCUSED);
            } else if (!this.isFocused()) {
                Task.unfocusAll();
                this.focus();
            }
            const focusedTasks = Task.getAllFocused();
            focusedTasks.forEach(focused => focused.elm.classList.add(CLASS_MOVING));
            focused = focusedTasks;
            document.onmousemove = move;
            document.onmouseup = drop;

            const mousePos = getMousePosition(event);
            this.origin.x = mousePos.x;
            this.origin.y = mousePos.y;
            for (const f of focused) {
                f.origin.pos = f.getPosition();
            }
        };
        let scrolling = null;
        const move = event => {
            if ((event.clientY >= window.innerHeight && window.pageYOffset === 0) ||
                (event.clientY <= 0 && window.pageYOffset > 0) &&
                scrolling === null) {
                scrolling = Scroll.doScroll();
                scrolling.then(() => scrolling = null);
            }
            const mousePos = getMousePosition(event);
            for (const f of focused) {
                f.setPosition({
                    left: f.origin.pos.left + (mousePos.x - this.origin.x),
                    top: f.origin.pos.top + (mousePos.y - this.origin.y)
                });
            }
        };
        const comeback = (pos, max) => {
            if (pos < 0) {
                return 0;
            } else if (pos > max) {
                return max - 10;
            }
            return pos;
        };

        const drop = _ => {
            window.getSelection().collapse(document.body, 0);
            for (const f of focused) {
                const pos = f.getPosition();
                const newLeft = comeback(pos.left, 100);
                const newTop = comeback(pos.top, 200);
                f.elm.classList.remove(CLASS_MOVING);
                f.setPosition({
                    left: newLeft,
                    top: newTop
                });
            }
            document.onmousemove = null;
            document.onmouseup = null;
            focused.length = 0;
        };

        const hover = event => {
            const comment = this.elm.querySelector('comment');
            if (!comment) {
                return;
            }
            const rect = this.elm.getBoundingClientRect();
            comment.style.top = (event.clientY - rect.top) / rect.height * 100 + 1 + '%';
            comment.style.left = (event.clientX - rect.left) / rect.width * 100 + 1 + '%';
        };

        this.elm.onmousemove = hover;

        this.elm.onmousedown = mousedown;
        this.elm.ondblclick = event => this.edit();

        this.input.onkeydown = event => {
            if (event.code === 'Tab') {
                applyText();
                event.preventDefault();
            } else if (event.ctrlKey && event.code === 'Enter') {
                if (event.shiftKey) {
                    this.input.value = this.input.value + '\n\n' + '<comment>\n\n</comment>';
                    this.input.selectionEnd = this.input.value.length - '</comment>'.length - 1;
                } else {
                    const br = event.altKey ? '<br>\n' : '  \n';
                    const cursor = this.input.selectionEnd;
                    this.input.value = this.input.value.substring(0, cursor) + br + this.input.value.substring(cursor);
                    this.input.selectionEnd = cursor + br.length;
                }
                event.preventDefault();
            }
            event.stopPropagation();
        };
        this.input.onkeyup = event => {
            if (event.code === 'Escape') {
                const input = event.target;
                this.elm.classList.remove(CLASS_EDITING);
                input.value = input.dataset.originalValue;
                document.onkeyup = Task.#onDocumentKeyUp;
                this.elm.onmousedown = mousedown;
            }
        };
        this.input.onblur = _ => applyText();
        const applyText = () => {
            this.setText(this.input.value);
            document.onkeyup = Task.#onDocumentKeyUp;
            this.elm.onmousedown = mousedown;
        };
    }

    edit() {
        if (!this.elm.classList.contains(CLASS_EDITING)) {
            Task.#onDocumentKeyUp = document.onkeyup;
            this.input.dataset.originalValue = this.input.value;
            this.input.style.height = this.elm.getBoundingClientRect().height + 'px';
            document.onkeyup = null;
            this.elm.onmousedown = null;
            this.elm.classList.add(CLASS_EDITING);
            this.input.focus();
        }
    }

    setColor(color) {
        this.elm.classList.remove(...CLASS_COLOR);
        this.elm.classList.add(color);
        db.edit(this.id, { color });
    }

    setText(text) {
        this.elm.classList.remove(CLASS_EDITING);
        this.displayText.innerHTML = marked.parse(text);
        this.input.value = text;
        db.edit(this.id, { text });
    }

    getPosition() {
        return {
            left: Number(this.elm.style.left.replace('%', '')),
            top: Number(this.elm.style.top.replace('%', ''))
        };
    }

    setPosition(pos) {
        this.elm.style.top = pos.top + '%';
        this.elm.style.left = pos.left + '%';
        db.edit(this.id, { top: pos.top, left: pos.left });
    }

    remove() {
        this.elm.textContent = null;
        $tasks.removeChild(this.elm);
        db.deleteTask(this.id);
    }

    toFront() {
        $tasks.insertAdjacentElement('beforeend', this.elm);
        db.toFront(this.id);
    }

    focus() {
        this.elm.classList.add(CLASS_FOCUSED);
    }

    unfocus() {
        this.elm.classList.remove(CLASS_FOCUSED);
    }

    static unfocusAll() {
        Task.getAllFocused().forEach(task => task.unfocus());
    }

    isFocused() {
        return this.elm.classList.contains(CLASS_FOCUSED);
    }

    static getAllFocused() {
        return Task.instances.filter(t => t.elm.classList.contains(CLASS_FOCUSED));
    }

    static get(id) {
        return Task.instances.find(t => t.id === id);
    }
}

document.getElementById('tasks').innerHTML = '';

for (const task of await db.getAll()) {
    Task.create({
        id: task.id,
        top: task.top,
        left: task.left,
        text: task.text,
        color: task.color,
    });
}

const container = document.getElementById('container');
const createTask = e => {
    const top = (e.clientY + window.pageYOffset) / document.documentElement.clientHeight * 100;
    const left = (e.clientX / document.documentElement.clientWidth) * 100;
    Task.create({ top, left });
};
container.ondblclick = createTask;
container.onmousedown = _ => Task.unfocusAll();
document.onkeyup = e => {
    const key = e.code;
    if (key === 'F2') {
        const focusedTasks = Task.getAllFocused();
        focusedTasks.length && focusedTasks[0].edit();
    } else {
        Menu.keyCommand(key);
    }
    Menu.hide();
};
document.onclick = _ => {
    Menu.hide();
    SystemMenu.hide();
};

const selection = new SelectionArea({
    selectables: ['.task'],
    boundaries: ['#container'],
}).on('start', () => {
    Task.unfocusAll();
    selection.clearSelection();
}).on('move', ({ store: { changed: { added, removed } } }) => {
    for (const el of added) {
        Task.get(el.id).focus();
    }
    for (const el of removed) {
        Task.get(el.id).unfocus();
    }
});

const Menu = new class {
    constructor() {
        this.elm = document.getElementById('menu');

        this.binds = Array.from(document.getElementsByClassName('menu-item'))
            .map(m => ({
                key: m.dataset.key,
                func: _ => m.click()
            }));

        const onColorMenuClick = e => {
            const focused = Task.getAllFocused();
            for (const task of focused) {
                task.setColor(e.currentTarget.dataset.color);
            }
        };
        this.elm.querySelectorAll('.menu-item.color').forEach(menu => menu.onclick = onColorMenuClick);

        const onToFrontMenuClick = () => {
            const focusedTasks = Task.getAllFocused();
            if (focusedTasks.length === 1) {
                Task.get(focusedTasks[0].id).toFront();
                return;
            }
            focusedTasks.map(task => ({
                task,
                pos: task.getPosition()
            }))
                .sort((t1, t2) => t1.pos.top - t2.pos.top)
                .forEach(t => t.task.toFront());
        };
        document.getElementById('menu-tofront').onclick = onToFrontMenuClick;

        const onMoveMenuClick = () => {
            const focused = Task.getAllFocused();
            const pos = focused[0].getPosition();
            if (pos.top < 100 && window.pageYOffset === 0) {
                Scroll.doScroll(1);
            } else if (pos.top >= 100 && window.pageYOffset > 0) {
                Scroll.doScroll(0);
            }
            for (const task of focused) {
                const pos = task.getPosition();
                task.setPosition({
                    left: pos.left,
                    top: pos.top < 100 ? pos.top + 100 : pos.top - 100
                });
            }
        };
        document.getElementById('menu-move').onclick = onMoveMenuClick;

        const onDeleteMenuClick = () => {
            Task.getAllFocused().forEach(t => t.remove());
        };
        document.getElementById('menu-delete').onclick = onDeleteMenuClick;
    }

    keyCommand(keycode) {
        this.binds.find(bind => bind.key === keycode)?.func();
    }

    show(e) {
        e.preventDefault();
        const x = e.clientX;
        const y = e.clientY;
        const innerHeight = window.innerHeight;
        const innerWidth = window.innerWidth;
        if (y + this.elm.offsetHeight > innerHeight) {
            this.elm.style.bottom = (innerHeight - y - window.pageYOffset) + 'px';
            this.elm.style.top = 'auto';
        } else {
            this.elm.style.bottom = 'auto';
            this.elm.style.top = y + window.pageYOffset + 'px';
        }
        if (x + this.elm.offsetWidth > innerWidth) {
            this.elm.style.right = (innerWidth - x) + 'px';
            this.elm.style.left = 'auto';
        } else {
            this.elm.style.right = 'auto';
            this.elm.style.left = x + 'px';
        }
        this.elm.classList.add('show');
    }

    hide() {
        this.elm.classList.remove('show');
    }
}();

const Scroll = new class {
    elm = document.getElementById('scroll');
    #resolve;

    constructor() {
        this.elm.onclick = _ => Scroll.doScroll();
        const onScroll = elms => {
            const intersectingElm = elms.find(el => el.isIntersecting);
            if (!intersectingElm) {
                return;
            }
            this.#resolve?.();
            if (intersectingElm.target.id === 'container-stock') {
                this.elm.classList.add('on');
            } else {
                this.elm.classList.remove('on');
            }
        };
        this.observer = new IntersectionObserver(onScroll, {
            threshold: 1
        });
        this.observer.observe(document.getElementById('container-main'));
        this.observer.observe(document.getElementById('container-stock'));
    }

    doScroll(to) {
        const y = (to && document.documentElement.clientHeight) ||
            (window.pageYOffset > 0 ? 0 : document.documentElement.clientHeight);
        window.scroll(0, y);
        return new Promise(r => this.#resolve = r);
    }
}();

const SystemMenu = new class {
    elm = document.getElementById('system-menu');
    icon = document.getElementById('system-menu-icon');

    constructor() {
        this.icon.onclick = e => this.show(e);
        document.getElementById('menu-license').onclick = this.showLicense;
        document.getElementById('menu-export').onclick = this.export;
        document.getElementById('menu-import').onclick = this.import;
    }

    show(e) {
        this.elm.classList.add('show');
        e.stopPropagation();
    }

    hide() {
        this.elm.classList.remove('show');
    }

    async export() {
        const tasks = await db.getAll();
        const exported = tasks.map(task => {
            const ret = task;
            delete ret.id;
            return ret;
        });
        const blob = new Blob([ JSON.stringify(exported, null, 2) ], { type: 'application/json' });
        let anchor = document.getElementById('export-anchor');
        if (!anchor) {
            anchor = document.createElement('a');
            anchor.style.display = 'none';
            anchor.id = 'export-link';
            document.body.appendChild(anchor);
            anchor.download = 'kanban.json';
        }
        anchor.href = URL.createObjectURL(blob);
        anchor.click();
    }

    import() {
        let input = document.getElementById('import-input');
        if (!input) {
            input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/json';
            input.style.display = 'none';
            input.onchange = e => {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = contents => {
                    const tasks = JSON.parse(contents.target.result);
                    for (const task of tasks) {
                        Task.create(task);
                    }
                };
                reader.readAsText(file);
            };
        }
        input.click();
    }

    async showLicense() {
        const popup = window.open('about:blank', '_blank');
        popup.document.title = 'Kanban - 3rd Party Licenses';
        const data = await fetch('LICENSES.md').then(res => res.text());
        popup.document.body.innerHTML = marked.parse(data);
    }
}();
