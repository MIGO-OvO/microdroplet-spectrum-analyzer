from PySide6.QtWidgets import QComboBox, QDialog, QHBoxLayout, QLabel, QPushButton, QVBoxLayout


class ColumnSelectDialog(QDialog):
    def __init__(self, columns, parent=None):
        super().__init__(parent)
        self.setWindowTitle("选择数据列")
        layout = QVBoxLayout(self)
        time_layout = QHBoxLayout()
        time_layout.addWidget(QLabel("时间列:"))
        self.time_combo = QComboBox()
        self.time_combo.addItem("None")
        self.time_combo.addItems([str(col) for col in columns])
        time_layout.addWidget(self.time_combo)
        layout.addLayout(time_layout)
        data_layout = QHBoxLayout()
        data_layout.addWidget(QLabel("数据列:"))
        self.data_combo = QComboBox()
        self.data_combo.addItems([str(col) for col in columns])
        data_layout.addWidget(self.data_combo)
        layout.addLayout(data_layout)
        button_layout = QHBoxLayout()
        self.ok_button = QPushButton("确定")
        self.ok_button.clicked.connect(self.accept)
        self.cancel_button = QPushButton("取消")
        self.cancel_button.clicked.connect(self.reject)
        button_layout.addWidget(self.ok_button)
        button_layout.addWidget(self.cancel_button)
        layout.addLayout(button_layout)

    def accept(self):
        self.selected_time = self.time_combo.currentText()
        self.selected_data = self.data_combo.currentText()
        super().accept()
